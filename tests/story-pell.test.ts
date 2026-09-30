import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, LevelRuntime } from '@/core/types';
import type { StoryDialogueView, StoryRunSave } from '@/core/story';
import { PELL, PELL_BARKS, PELL_LAST_PAGE, PELL_NOTICES, PELL_PIN_PS, PELL_SECOND_TALK } from '@/content/story';
import { PellCamp, secretMark } from '@/game/story/PellCamp';
import type { PellFacts, StoryHost } from '@/game/story/host';
import { defaultStoryMeta, type StoryMetaData } from '@/game/story/storyMeta';
import { freshStoryRun } from '@/game/story/storyRun';
import { Cell } from '@/sim/CellType';

/**
 * PELL's dialogue as a state machine (wave 3 WS-S, then the Pell pass): greeting
 * line by line, a notice about the run, up to three choices, a reply, a real
 * gift, a farewell; the tea is refused to the well; a choice that only talks
 * brings the menu back; a second talk on the same floor is a fresh turn of
 * phrase; he recognises a repeat visitor; his barks, his mark, his camera; the
 * Kiln's camp is cold and holds his last page.
 */

type Biome = 'earthen' | 'fungal' | 'frozen' | 'flooded' | 'crystal' | 'volcanic';

interface Opts {
  meta?: StoryMetaData;
  facts?: Partial<PellFacts>;
  hp?: number;
  run?: Partial<StoryRunSave>;
}

function harness(biome: Biome, levelId: string, opts: Opts = {}) {
  const events = new EventBus();
  let clock = 10;
  let run: StoryRunSave = { ...freshStoryRun(1), ...opts.run };
  let m = opts.meta ?? defaultStoryMeta();
  const views: StoryDialogueView[] = [];
  const said: string[] = [];
  const barks: Array<{ text: string; priority: string; source: string; captioned?: boolean }> = [];
  const toasts: string[] = [];
  const cards: string[] = [];
  events.on('storyDialogue', (v) => views.push(v));
  events.on('toast', ({ text }) => toasts.push(text));
  const camp = { x: 500, floorY: 400, facing: -1 as const, x0: 460, x1: 540 };
  const pickups = [{ kind: 'tome', x: 900, y: 300, taken: false, data: {} }];
  const rt = {
    def: { id: levelId, biome }, story: { pipes: [], camp, valve: null, flue: null }, living: biome === 'earthen' ? { glowseeds: 0 } : undefined,
    pickups, runeVaults: [], spawn: { x: 100, y: 100 }, mapWaypoint: null,
  } as unknown as LevelRuntime;
  const player = { x: 490, y: 400, dead: false, hp: opts.hp ?? 20, maxHp: 100 };
  const W = 1000;
  const world = { inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < 600, idx: (x: number, y: number) => x + y * W, types: new Uint8Array(W * 600) };
  const enemies: Array<{ kind: string; x: number; y: number; hp: number; boss?: object }> = [];
  const camera: { actionFocus: { x: number; y: number; zoom: number } | null } = { actionFocus: null };
  const state = { mode: 'play', reduceCameraShake: false };
  const ctx = {
    events, player, levels: { current: rt }, world, enemies, camera, state,
    audio: new Proxy({}, { get: () => () => undefined }),
    narrator: { cutSource: () => undefined },
    wands: { collection: [], wands: [], grantCard: (_c: Ctx, id: string) => cards.push(id) },
  } as unknown as Ctx;
  let corpse = false;
  const facts: PellFacts = { floor: Number(levelId.slice(1, 2)), kit: 'spark', phials: 3, deaths: 0, hpFrac: player.hp / player.maxHp, gold: 0, boons: [], difficulty: 2, daily: false, ...opts.facts };
  const host: StoryHost = {
    ctx, meta: () => m, updateMeta: (fn) => { m = fn(m); }, run: () => run, setRun: (next) => { run = next; },
    say: (lines, o) => {
      if (o.source === 'pell-bark') barks.push({ text: lines[0]!.text, priority: o.priority, source: o.source, captioned: o.captioned });
      else said.push(...lines.map(l => l.text));
      return true;
    },
    lineSeconds: () => 2, voiced: () => true, unlockJournal: () => undefined,
    levelId: () => levelId, biome: () => biome, floor: () => Number(levelId.slice(1, 2)), now: () => clock,
    facts: () => ({ ...facts, hpFrac: player.hp / player.maxHp }),
    carryingCorpse: () => corpse,
    sees: () => true,
  };
  const pell = new PellCamp(host);
  const tick = (s: number): void => { for (let i = 0; i < Math.round(s * 60); i++) { clock += 1 / 60; pell.update(1 / 60); } };
  /** Say the greeting and notice through to the menu. */
  const toMenu = (): void => { for (let i = 0; i < 30 && views.at(-1)?.choices.length === 0; i++) tick(2.6); };
  return {
    pell, tick, toMenu, views, said, barks, toasts, cards, rt, player, camp, enemies, camera, state, world, pickups,
    setCorpse: (v: boolean) => { corpse = v; },
    get run() { return run; }, get meta() { return m; }, get menu() { return views.at(-1)!.choices; },
  };
}

describe('Pell', () => {
  it('greets line by line, offers his choices, gives a real gift, says farewell and closes', () => {
    const h = harness('earthen', 'd1');
    expect(h.pell.prompt()?.verb).toBe('Talk to Pell');
    expect(h.pell.interact()).toBe(true);
    expect(h.said[0]).toBe(PELL.earthen!.first.greet[0]);
    expect(h.views.at(-1)).toMatchObject({ open: true, name: 'Pell', choices: [] });
    h.tick(2.6);
    expect(h.said[1]).toBe(PELL.earthen!.first.greet[1]);
    h.tick(2.6);
    expect(h.views.at(-1)!.choices).toEqual(PELL.earthen!.first.choices.map(c => c.label));
    // The glowseeds.
    h.pell.choose(2);
    expect((h.rt.living as { glowseeds: number }).glowseeds).toBe(3);
    expect(h.run.pell.d1).toEqual({ met: true, gift: 'seeds' });
    h.tick(2.6);
    expect(h.said.at(-1)).toBe(PELL.earthen!.first.farewell);
    h.tick(2.6);
    expect(h.views.at(-1)!.open).toBe(false);
    expect(h.meta.pellRuns).toBe(1);
    // Again on the same floor this run, the gift taken: a fresh turn of phrase, no menu, and not the farewell over again.
    h.pell.interact();
    expect([...PELL_SECOND_TALK.bye, ...PELL_SECOND_TALK.floor.earthen!]).toContain(h.said.at(-1));
    expect(h.said.at(-1)).not.toBe(PELL.earthen!.first.farewell);
    expect(h.views.at(-1)!.choices).toEqual([]);
  });

  it('never says the same second-talk line twice running', () => {
    const h = harness('flooded', 'd3', { run: { pell: { d3: { met: true, gift: 'page' } } } });
    let last = '';
    for (let i = 0; i < 40; i++) {
      h.pell.interact();
      const line = h.said.at(-1)!;
      expect(line, `talk ${i}`).not.toBe(last);
      last = line;
      h.pell.close();
    }
  });

  it('E skips the typing first, then moves on; walking away ends it', () => {
    const h = harness('earthen', 'd1');
    h.pell.interact();
    h.pell.advance();
    expect(h.views.at(-1)!.instant).toBe(true);
    expect(h.said).toHaveLength(1);
    h.pell.advance();
    expect(h.said).toHaveLength(2);
    h.player.x = 700;
    h.tick(0.1);
    expect(h.pell.talking).toBe(false);
  });

  it('recognises a repeat visitor, and a regular gets one line and the whole menu', () => {
    const h = harness('earthen', 'd1', { meta: { ...defaultStoryMeta(), heard: [PELL.earthen!.first.id], pellRuns: 1 } });
    h.pell.interact();
    expect(h.said[0]).toBe(PELL.earthen!.again.greet[0]);
    const v = harness('earthen', 'd1', { meta: { ...defaultStoryMeta(), heard: [PELL.earthen!.first.id], pellRuns: 4 } });
    v.pell.interact();
    expect(v.said[0]).toBe(PELL.earthen!.veteran!.greet[0]);
    expect(PELL.earthen!.veteran!.greet).toHaveLength(1);
    v.toMenu();
    expect(v.menu).toEqual(['What’s below?', 'Come with me.', 'Any glowseeds?']);
  });

  it('has a veteran visit on every floor he camps on', () => {
    for (const [biome, floor] of Object.entries(PELL)) expect(floor!.veteran, biome).toBeDefined();
    const h = harness('flooded', 'd3', { meta: { ...defaultStoryMeta(), heard: [PELL.flooded!.first.id], pellRuns: 5 } });
    h.pell.interact();
    expect(h.said[0]).toBe(PELL.flooded!.veteran!.greet[0]);
  });

  it('marks a secret on the compass, or pours his tea', () => {
    const h = harness('flooded', 'd3');
    h.pell.interact();
    h.toMenu();
    h.pell.choose(0);
    expect(h.rt.mapWaypoint).toMatchObject({ x: 900, y: 300, label: 'Pell’s mark' });
    const t = harness('flooded', 'd3');
    t.pell.interact();
    t.toMenu();
    t.pell.choose(2);
    expect(t.player.hp).toBe(100);
    expect(secretMark({ pickups: [], runeVaults: [], spawn: { x: 0, y: 0 } } as unknown as LevelRuntime, null)).toBeNull();
  });

  it('on the Kiln his camp is cold, and his last page is read once', () => {
    const h = harness('volcanic', 'd4');
    expect(h.pell.view()).toBeNull();
    expect(h.pell.prompt()?.verb).toBe('Read the page');
    h.pell.interact();
    expect(h.said[0]).toMatch(/The stoker is sad/);
    expect(h.run.pell.d4).toEqual({ met: false, gift: 'page' });
    h.tick(6);
    expect(h.pell.prompt()).toBeNull();
  });

  it('walking away from the page puts it down', () => {
    const h = harness('volcanic', 'd4');
    h.pell.interact();
    expect(h.pell.talking).toBe(true);
    h.player.x = 900;
    h.tick(0.1);
    expect(h.pell.talking).toBe(false);
  });
});

describe('Pell: choices made real', () => {
  it('refuses his tea to someone in rude health: the gift is not spent and the menu stays open', () => {
    const h = harness('flooded', 'd3', { hp: 95 });
    h.pell.interact();
    h.toMenu();
    // The button says so before you press it.
    expect(h.views.at(-1)!.hints).toEqual(['Compass mark', 'A spell page', 'You’re unhurt']);
    h.pell.choose(2);
    h.tick(0.1);
    expect(h.said.at(-1)).toBe(PELL.flooded!.first.choices[2]!.refuse![0]);
    expect(h.player.hp).toBe(95);
    expect(h.run.pell.d3).toEqual({ met: true, gift: null });
    expect(h.toasts.some(t => /tea/i.test(t))).toBe(false);
    // Back to the menu, the tea gone from it, the other two still his to give.
    h.tick(2.6);
    expect(h.views.at(-1)!.choices).toEqual([PELL.flooded!.first.choices[0]!.label, PELL.flooded!.first.choices[1]!.label]);
    h.pell.choose(1);
    expect(h.cards.length).toBe(1);
    expect(h.run.pell.d3).toEqual({ met: true, gift: 'page' });
  });

  it('pours the tea for someone who is hurt, and the button says it restores health', () => {
    const h = harness('flooded', 'd3', { hp: 40 });
    h.pell.interact();
    h.toMenu();
    expect(h.views.at(-1)!.hints![2]).toBe('Restores health');
    h.pell.choose(2);
    expect(h.player.hp).toBe(100);
    expect(h.run.pell.d3).toEqual({ met: true, gift: 'tea' });
  });

  it('a choice that only talks brings the menu back, so the gift is not lost to curiosity', () => {
    const h = harness('earthen', 'd1');
    h.pell.interact();
    h.toMenu();
    h.pell.choose(0);
    expect(h.said.at(-1)).toBe(PELL.earthen!.first.choices[0]!.reply[0]);
    h.tick(2.6);
    expect(h.views.at(-1)!.choices).toEqual(['Come with me.', 'Anything for the road?']);
    h.pell.choose(1);
    expect((h.rt.living as { glowseeds: number }).glowseeds).toBe(3);
    h.tick(2.6);
    expect(h.said.at(-1)).toBe(PELL.earthen!.first.farewell);
  });

  it('comes back to an unspent gift with the menu, not a bare farewell', () => {
    const h = harness('flooded', 'd3', { run: { pell: { d3: { met: true, gift: null } } } });
    h.pell.interact();
    expect(PELL_SECOND_TALK.menu).toContain(h.said[0]);
    h.toMenu();
    expect(h.menu).toEqual(PELL.flooded!.first.choices.map(c => c.label));
  });

  it('keeps gifts exclusive: one a floor', () => {
    const h = harness('flooded', 'd3', { hp: 40 });
    h.pell.interact();
    h.toMenu();
    h.pell.choose(0);
    h.tick(10);
    h.pell.interact();
    h.toMenu();
    expect(h.menu).toEqual([]);
    expect(h.run.pell.d3!.gift).toBe('pin');
  });
});

describe('Pell: the echo, the mark, the page', () => {
  it('offers "I saw you come down." only after the floor-2 echo has played, once', () => {
    const before = harness('fungal', 'd2');
    before.pell.interact();
    before.toMenu();
    expect(before.menu).toEqual(['Show me something.', 'Found anything?']);

    const h = harness('fungal', 'd2', { run: { echoes: ['echo.rot'] } });
    h.pell.interact();
    h.toMenu();
    expect(h.menu).toEqual(['Show me something.', 'Found anything?', 'I saw you come down.']);
    h.pell.choose(2);
    expect(h.said.at(-1)).toMatch(/very good rope/);
    // The gift is still his to give.
    h.tick(2.6);
    expect(h.menu).toEqual(['Show me something.', 'Found anything?']);
    h.pell.choose(0);
    h.tick(10);
    // Back to him after the gift: only the new answer is offered, and only once.
    const again = harness('fungal', 'd2', { run: { echoes: ['echo.rot'], told: ['once.rope'], pell: { d2: { met: true, gift: 'pin' } } } });
    again.pell.interact();
    expect(again.views.at(-1)!.choices).toEqual([]);
  });

  it('the answer stays on the menu when he is met after the gift and the rope has not been asked about', () => {
    const h = harness('fungal', 'd2', { run: { echoes: ['echo.rot'], pell: { d2: { met: true, gift: 'page' } } } });
    h.pell.interact();
    h.toMenu();
    expect(h.menu).toEqual(['I saw you come down.']);
  });

  it('remembers his mark, and is paid when a pickup near it is taken', () => {
    const h = harness('flooded', 'd3');
    h.pell.interact();
    h.toMenu();
    h.pell.choose(0);
    expect(h.run.pin).toEqual({ level: 'd3', x: 900, y: 300, taken: 0 });
    h.tick(1);
    expect(h.run.pinsPaid).toEqual([]);
    h.pickups[0]!.taken = true;
    h.tick(0.5);
    expect(h.run.pinsPaid).toEqual(['d3']);
    expect(h.run.pin).toBeNull();
  });

  it('a pickup taken before the mark was given does not pay it', () => {
    const h = harness('flooded', 'd3');
    h.pickups.push({ kind: 'chest', x: 880, y: 310, taken: true, data: {} });
    h.pell.interact();
    h.toMenu();
    h.pell.choose(0);
    expect(h.run.pin!.taken).toBe(1);
    h.tick(1);
    expect(h.run.pinsPaid).toEqual([]);
  });

  it('answers a paid mark on the next floor, and under the last page', () => {
    const h = harness('flooded', 'd3', { hp: 100, run: { pinsPaid: ['d2'] } });
    h.pell.interact();
    h.tick(7);
    expect(h.said.some(s => /opened it, didn’t you/.test(s))).toBe(true);
    const page = harness('volcanic', 'd4', { run: { pinsPaid: ['d3'] } });
    page.pell.interact();
    for (let i = 0; i < 12; i++) page.pell.advance();
    expect(page.said).toContain(PELL_PIN_PS.first);
    expect(page.said).toContain(PELL_LAST_PAGE.first.lines[0]);
    const none = harness('volcanic', 'd4');
    none.pell.interact();
    for (let i = 0; i < 12; i++) none.pell.advance();
    expect(none.said).not.toContain(PELL_PIN_PS.first);
  });
});

describe('Pell reads the run', () => {
  const notices = (h: ReturnType<typeof harness>): string[] => h.said.filter(s => PELL_NOTICES.some(n => n.text === s));

  it('says one notice after the greeting, from what the run holds', () => {
    const h = harness('fungal', 'd2', { hp: 100, facts: { kit: 'ember' } });
    h.pell.interact();
    h.tick(6);
    expect(h.said[0]).toBe(PELL.fungal!.first.greet[0]);
    expect(h.said[2]).toMatch(/Flame Jet\. In the Rot Gardens/);
    expect(notices(h)).toHaveLength(1);
    expect(h.run.told).toContain('notice.ember.fungal');
    expect(h.meta.heard).toContain('pell.notice.ember.fungal');
  });

  it('never says the same notice twice in a run, and not on the first meeting ever', () => {
    const first = harness('earthen', 'd1', { facts: { kit: 'spark', floor: 1 } });
    first.pell.interact();
    first.tick(8);
    expect(notices(first)).toEqual([]);
    // Two floors, the same facts: the second visit has something else to say, or nothing.
    const h = harness('fungal', 'd2', { facts: { kit: 'spark', hpFrac: 1 }, hp: 100 });
    h.pell.interact();
    h.tick(8);
    const a = notices(h);
    expect(a).toHaveLength(1);
    const told = h.run.told;
    const next = harness('flooded', 'd3', { facts: { kit: 'spark', floor: 3 }, hp: 100, run: { told } });
    next.pell.interact();
    next.tick(8);
    for (const line of notices(next)) expect(a).not.toContain(line);
  });

  it('a hurt apprentice is noticed before a kit joke', () => {
    const h = harness('fungal', 'd2', { facts: { kit: 'ember' }, hp: 20 });
    h.pell.interact();
    h.tick(6);
    expect(h.said[2]).toMatch(/more of yourself on the outside/);
  });

  it('a second talk on the same floor has no notice', () => {
    const h = harness('fungal', 'd2', { facts: { kit: 'ember' }, run: { pell: { d2: { met: true, gift: 'page' } } } });
    h.pell.interact();
    h.tick(6);
    expect(notices(h)).toEqual([]);
  });
});

describe('Pell barks', () => {
  /** A quiet spot: healthy, nobody about. */
  const calm = (biome: Biome = 'fungal', id = 'd2') => {
    const h = harness(biome, id, { hp: 100 });
    h.tick(7);
    return h;
  };

  it('startles at a fire near his camp, once a run', () => {
    const h = calm();
    for (let i = 0; i < 4; i++) h.world.types[h.world.idx(510 + i, 395)] = Cell.Fire;
    h.tick(0.3);
    expect(h.barks).toHaveLength(1);
    expect(h.barks[0]).toMatchObject({ text: PELL_BARKS.fire.text, priority: 'low', source: 'pell-bark', captioned: true });
    expect(h.pell.debug().react).toBe('startle');
    expect(h.run.told).toContain('bark.fire');
    h.tick(40);
    expect(h.barks).toHaveLength(1);
  });

  it('does not mind a fire far from his camp', () => {
    const h = calm();
    for (let i = 0; i < 6; i++) h.world.types[h.world.idx(700 + i, 395)] = Cell.Fire;
    h.tick(2);
    expect(h.barks).toHaveLength(0);
  });

  it('points at a hostile in sight, with a line for its kind, each once', () => {
    const h = calm();
    h.enemies.push({ kind: 'slime', x: 560, y: 400, hp: 10 });
    h.tick(0.3);
    expect(h.barks.at(-1)!.text).toBe(PELL_BARKS.hostile.slime.text);
    expect(h.pell.debug().react).toBe('point');
    h.enemies[0]!.kind = 'bat';
    h.tick(20);
    expect(h.barks.at(-1)!.text).toBe(PELL_BARKS.hostile.bat.text);
    h.enemies[0]!.kind = 'imp';
    h.tick(20);
    expect(h.barks.at(-1)!.text).toBe(PELL_BARKS.hostile.any.text);
    const n = h.barks.length;
    h.enemies[0]!.kind = 'slime';
    h.tick(40);
    expect(h.barks).toHaveLength(n);
  });

  it('ignores a hostile he cannot see, a dead one and a boss', () => {
    const h = calm();
    h.enemies.push({ kind: 'slime', x: 560, y: 400, hp: 0 }, { kind: 'colossus', x: 520, y: 400, hp: 100 }, { kind: 'slime', x: 900, y: 400, hp: 5 });
    h.tick(2);
    expect(h.barks).toHaveLength(0);
  });

  it('kneels when a corpse is carried in; speaks up when you linger; notices a wound', () => {
    const c = calm();
    c.setCorpse(true);
    c.tick(0.3);
    expect(c.barks[0]!.text).toBe(PELL_BARKS.corpse.text);
    expect(c.pell.debug().react).toBe('kneel');

    const l = harness('fungal', 'd2', { hp: 100, meta: { ...defaultStoryMeta(), pellRuns: 1 } });
    l.tick(7);
    expect(l.barks).toHaveLength(0);
    l.tick(4);
    expect(l.barks[0]!.text).toBe(PELL_BARKS.linger.text);

    const w = harness('fungal', 'd2', { hp: 20 });
    w.tick(7);
    expect(w.barks[0]!.text).toBe(PELL_BARKS.hurt.text);
  });

  it('keeps quiet in a first meeting: no lingering remark before he has spoken to you', () => {
    const h = harness('earthen', 'd1', { hp: 100 });
    h.tick(30);
    expect(h.barks).toHaveLength(0);
  });

  it('never barks over a conversation, to someone far off, or one bark hard on another', () => {
    const talking = harness('fungal', 'd2', { hp: 20 });
    talking.pell.interact();
    talking.tick(9);
    expect(talking.barks).toHaveLength(0);

    const far = harness('fungal', 'd2', { hp: 20 });
    far.player.x = 900;
    far.tick(9);
    expect(far.barks).toHaveLength(0);

    const h = calm();
    h.setCorpse(true);
    for (let i = 0; i < 4; i++) h.world.types[h.world.idx(510 + i, 395)] = Cell.Fire;
    h.tick(0.3);
    expect(h.barks).toHaveLength(1);
    h.tick(5);
    expect(h.barks).toHaveLength(1);
    h.tick(10);
    expect(h.barks).toHaveLength(2);
  });
});

describe('Pell on stage', () => {
  it('eases the camera to a two-shot for the talk and hands it back', () => {
    const h = harness('fungal', 'd2', { hp: 100 });
    h.pell.interact();
    h.tick(0.1);
    expect(h.camera.actionFocus).not.toBeNull();
    expect(h.camera.actionFocus!.x).toBeCloseTo(495);
    h.player.x = 470;
    h.tick(0.1);
    expect(h.camera.actionFocus!.x).toBeCloseTo(485);
    h.pell.close();
    expect(h.camera.actionFocus).toBeNull();
  });

  it('leaves the camera alone for reduced motion, a wound, or a shot someone else holds', () => {
    const calm = harness('fungal', 'd2');
    calm.state.reduceCameraShake = true;
    calm.pell.interact();
    calm.tick(0.2);
    expect(calm.camera.actionFocus).toBeNull();

    const hurt = harness('fungal', 'd2');
    hurt.pell.interact();
    hurt.tick(0.2);
    expect(hurt.camera.actionFocus).not.toBeNull();
    hurt.player.hp -= 5;
    hurt.tick(0.1);
    expect(hurt.camera.actionFocus).toBeNull();

    const held = harness('fungal', 'd2');
    const theirs = { x: 1, y: 2, zoom: 1.2 };
    held.camera.actionFocus = theirs;
    held.pell.interact();
    held.tick(0.2);
    expect(held.camera.actionFocus).toBe(theirs);
    held.pell.close();
    expect(held.camera.actionFocus).toBe(theirs);
  });

  it('his mouth follows the line being said, and stops when it ends', () => {
    const h = harness('fungal', 'd2');
    h.pell.interact();
    const seen = new Set<number | undefined>();
    const fig = h.pell.view()!;
    for (let i = 0; i < 100; i++) { h.tick(0.02); seen.add(fig.mouth); }
    expect([...seen].some(v => typeof v === 'number' && v > 0.5)).toBe(true);
    expect([...seen].some(v => v === 0)).toBe(true);
    h.toMenu();
    expect(fig.mouth).toBeUndefined();
  });

  it('looks round at you at once and turns his body a moment after', () => {
    const h = harness('fungal', 'd2');
    const fig = h.pell.view()!;
    h.tick(0.1);
    expect(fig.facing).toBe(-1);
    h.player.x = 520;
    h.tick(0.05);
    expect(fig.headFacing).toBe(1);
    expect(fig.facing).toBe(-1);
    h.tick(0.3);
    expect(fig.facing).toBe(1);
  });

  it('wears a bandage from the third floor, and his camp shows what the run has gathered', () => {
    const early = harness('fungal', 'd2');
    early.tick(0.1);
    expect(early.pell.view()!.bandaged).toBe(false);
    const h = harness('flooded', 'd3', { run: { pell: { d1: { met: true, gift: 'seeds' }, d2: { met: true, gift: 'page' } } } });
    h.tick(0.1);
    expect(h.pell.view()!.bandaged).toBe(true);
    expect(h.pell.dress()).toMatchObject({ floor: 3, pages: 2, cup: false, frost: false, tin: 'none' });
  });
});

import type { BiomeId, Ctx } from '@/core/types';
import type {
  StoryApi,
  StoryJournalPage,
  StoryRenderView,
  StoryRunSave,
  StorySpeakOptions,
  StorySpokenLine,
} from '@/core/story';
import {
  ASH_DOORS,
  ASH_GREETINGS,
  DOCENT_ASIDES,
  DOCENT_PIPES,
  ENDING_AGAIN,
  ENDING_FIRST,
  OPENING,
  OPENING_MAX_SECONDS,
  STORY_FLOOR_NAMES,
  journalEntries,
  type Plate,
} from '@/content/story';
import { NARRATION_CLIPS } from '@/content/audio/narration.generated';
import { readingSeconds, speakerKey } from '@/audio/narrationText';
import { LEVELS, floorOf } from '@/config/worldgraph';
import { beatLine, defaultStoryMeta, StoryMetaStore, withHeard, withJournal, type StoryMetaData } from './storyMeta';
import { freshStoryRun, pipeLine, pellWaits, sanitizeStoryRun, withPipeSpoken } from './storyRun';
import type { StoryHost } from './host';
import { PellCamp } from './PellCamp';
import { EchoStage } from './EchoStage';
import { BossPrologue } from './BossPrologue';
import { KilnEscape } from './KilnEscape';
import { StoryCinema } from './StoryCinema';

/** Pipes listen for a passer-by within this (cells, horizontally; the band above the floor below). */
const PIPE_REACH_X = 30;
const PIPE_REACH_UP = 64;
/** Matron Ash's greeting and door line together, at most (s): longer and the door line waits for a look at the door. */
const ASH_MAX_S = 11;
/** A pipe passed while the air was taken stays armed this long, and speaks while you are within earshot. */
const PIPE_ARMED_S = 12;
const PIPE_EARSHOT = 150;

/**
 * THE STORY DIRECTOR (Breathing Works wave 3, WS-S): the narrative spine, in
 * play. It owns what the Works have told a player across runs (the story
 * meta: beats heard, runs begun, time spent with Pell, the Journal) and within
 * this one (the story slice of the expedition save), and runs every scripted
 * interaction:
 *
 *  - the Docent's SPEAKING-PIPES: walk past and he says a line of lore (once
 *    per run per pipe; first runs hear the rich lines in the order walked,
 *    repeat runs a light `again`), voiced and captioned, never over another
 *    line (the narrator's queue);
 *  - PELL at his camp on every floor (game/story/PellCamp);
 *  - the MEMORY ECHOES at each floor's resonant valve (EchoStage);
 *  - the BOSS PROLOGUES (BossPrologue);
 *  - THE KILN ESCAPE, and victory after it (KilnEscape);
 *  - MATRON ASH's words in the Sanctum;
 *  - the OPENING and the ENDING (StoryCinema);
 *  - one-time asides (the first telekinetic lift).
 *
 * Events outward (`storyDialogue`, `storyCinema`, the narrator's `narration`),
 * calls inward (StoryApi). It never touches the DOM.
 */
export class StoryDirector implements StoryApi {
  private readonly store = new StoryMetaStore();
  /** Untracked runs (test runs, the Builder) read and write a session copy, never the player's memory. */
  private sessionMeta: StoryMetaData | null = null;
  private tracked = false;
  private state: StoryRunSave = freshStoryRun(0);
  private readonly host: StoryHost;
  private readonly pell: PellCamp;
  private readonly echo: EchoStage;
  private readonly prologue: BossPrologue;
  private readonly escape: KilnEscape;
  private readonly cinema: StoryCinema;
  private readonly disposers: Array<() => void> = [];
  private readonly pipeGlow = new Map<string, number>();
  /** Pipes passed under (by id on this floor) and until when they may still speak. */
  private readonly pipeArmed = new Map<string, number>();
  private openingDue = false;
  private sanctumDoors = new Set<string>();
  private lastInput = 0;
  private lastTick = 0;
  private readonly renderView: StoryRenderView = { pipes: [], camp: null, pell: null, valve: null, echo: null, flue: null, prompt: null };

  constructor(private readonly ctx: Ctx) {
    this.host = {
      ctx,
      meta: () => this.meta(),
      updateMeta: (fn) => this.updateMeta(fn),
      run: () => this.state,
      setRun: (next) => { this.state = next; },
      say: (lines, opts) => this.say(lines, opts),
      lineSeconds: (line) => this.lineSeconds(line),
      unlockJournal: (...ids) => this.updateMeta(m => withJournal(m, ...ids)),
      levelId: () => this.levelId(),
      biome: () => this.biome(),
      floor: () => floorOf(this.levelId()),
      now: () => performance.now() / 1000,
    };
    this.pell = new PellCamp(this.host);
    this.echo = new EchoStage(this.host);
    this.prologue = new BossPrologue(this.host);
    this.escape = new KilnEscape(this.host);
    this.cinema = new StoryCinema(this.host);
    const on = ctx.events.on.bind(ctx.events);
    this.disposers.push(
      on('levelChanged', () => this.onLevelChanged()),
      on('telekinesis', ({ phase, target }) => { if (phase === 'grab' && target === 'corpse') this.aside('telekinesis'); }),
      on('structureStrike', ({ x, y, radius }) => this.pell.noise(x, y, Math.min(1, radius / 30))),
      on('groundImpact', ({ x, y, strength }) => { if (strength > 0.6) this.pell.noise(x, y, strength * 0.5); }),
      on('playerDied', () => { this.echo.end(); this.pell.close(); }),
      on('narration', ({ text, seconds, speaker }) => this.onNarration(text, seconds, speaker)),
    );
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
  }

  /* ---------------- memory ---------------- */

  private meta(): Readonly<StoryMetaData> {
    return this.tracked ? this.store.data : (this.sessionMeta ??= structuredClone(this.store.data));
  }

  private updateMeta(fn: (meta: StoryMetaData) => StoryMetaData): void {
    if (this.tracked) this.store.update(fn);
    else this.sessionMeta = fn(this.sessionMeta ?? structuredClone(this.store.data));
  }

  private levelId(): string | null {
    const id = this.ctx.levels?.current?.def.id ?? null;
    return id && LEVELS[id] ? id : null;
  }

  private biome(): BiomeId | null {
    return this.ctx.levels?.current?.def.biome ?? null;
  }

  /* ---------------- speaking ---------------- */

  private say(lines: readonly StorySpokenLine[], opts: StorySpeakOptions & { beats?: readonly string[] }): boolean {
    const narrator = this.ctx.narrator;
    const ok = narrator?.speak ? narrator.speak(lines, opts) : false;
    if (ok && opts.beats?.length) {
      this.updateMeta(m => withHeard(m, ...opts.beats!));
      const add = opts.beats.filter(id => !this.state.spoken.includes(id));
      if (add.length) this.state = { ...this.state, spoken: [...this.state.spoken, ...add] };
    }
    return ok;
  }

  private lineSeconds(line: StorySpokenLine): number {
    const clip = NARRATION_CLIPS[speakerKey(line.speaker, line.text)];
    return clip ? clip.seconds : readingSeconds(line.text);
  }

  /** A one-time aside, said once ever. */
  private aside(which: keyof typeof DOCENT_ASIDES): void {
    const beat = DOCENT_ASIDES[which];
    const line = beatLine(this.meta(), beat);
    if (!line?.fresh || this.ctx.state.mode !== 'play') return;
    this.say([{ speaker: 'docent', text: line.text }], { priority: 'normal', source: 'aside', ttlMs: 4000, captioned: true, repeatable: true, beats: [beat.id] });
  }

  private onNarration(text: string, seconds: number, speaker: string | undefined): void {
    if (speaker !== 'docent') return;
    // A pipe's line has really begun: now it counts as heard (and its horn glows exactly as long).
    const pending = this.pendingPipe;
    if (pending && pending.text === text) {
      this.pendingPipe = null;
      this.updateMeta(m => withJournal(withHeard(m, pending.beat), `journal.docent.${pending.biome}`));
      this.pipeGlow.set(pending.key, performance.now() / 1000 + seconds + 0.3);
    }
  }
  /** A pipe line accepted but not yet begun (a higher line may still cut it): re-armed if it never starts. */
  private pendingPipe: { key: string; levelId: string; pipeId: string; text: string; beat: string; biome: string; until: number } | null = null;
  /** The floor's arrival (its name, its epigraph) has the air for a moment before any pipe speaks. */
  private pipesQuietUntil = 0;

  /* ---------------- the run ---------------- */

  beginRun(opts: { tracked: boolean }): void {
    this.tracked = opts.tracked;
    this.sessionMeta = null;
    if (opts.tracked) this.store.update(m => ({ ...m, runsBegun: m.runsBegun + 1 }));
    this.state = freshStoryRun(this.meta().runsBegun);
    this.escape.reset();
    this.pipeGlow.clear();
    // The opening plays on a player's first descent (the title replays it on request).
    this.openingDue = opts.tracked && !this.meta().openingSeen;
  }

  snapshotForSave(): StoryRunSave | null {
    return this.tracked ? structuredClone(this.state) : null;
  }

  restoreFromSave(save: StoryRunSave | undefined): void {
    this.tracked = true;
    this.sessionMeta = null;
    this.state = sanitizeStoryRun(save, this.store.data.runsBegun);
    this.escape.reset();
    this.openingDue = false;
    // A run saved mid-escape restarts the climb at the flue's foot (after the level is in).
    if (this.state.escape === 'active') this.resumeEscapeAfterEntry = true;
    if (this.state.escape === 'done') this.finishAfterEntry = true;
  }
  private resumeEscapeAfterEntry = false;
  private finishAfterEntry = false;

  private onLevelChanged(): void {
    // Descend ends Matron Ash's words (the narrator fades whatever was still
    // being said: a new floor's title card never has her over it).
    this.ctx.narrator?.cutSource?.('sanctum-ash');
    this.pell.levelChanged();
    this.echo.levelChanged();
    this.prologue.levelChanged();
    this.escape.levelChanged();
    this.pipeGlow.clear();
    this.pipeArmed.clear();
    this.pendingPipe = null;
    this.pipesQuietUntil = performance.now() / 1000 + 7;
    if (this.resumeEscapeAfterEntry && this.ctx.levels.current?.story?.flue) {
      this.resumeEscapeAfterEntry = false;
      this.escape.resume(() => this.onEscaped());
    }
  }

  /* ---------------- the tick ---------------- */

  update(): void {
    const ctx = this.ctx;
    const now = performance.now() / 1000;
    const dt = this.lastTick > 0 ? Math.min(0.1, now - this.lastTick) : 1 / 60;
    this.lastTick = now;
    if (ctx.state.mode !== 'play' || !ctx.levels.current) { this.renderView.prompt = null; return; }
    if (this.openingDue && !ctx.levels.transitioning) {
      this.openingDue = false;
      void this.playOpening();
    }
    if (this.finishAfterEntry && !ctx.levels.transitioning) {
      this.finishAfterEntry = false;
      this.onEscaped();
    }
    // A key or a shot during a boss prologue hands the camera back.
    const k = ctx.input.keys;
    const input = (k.left ? 1 : 0) | (k.right ? 2 : 0) | (k.jump ? 4 : 0) | (ctx.player.firing ? 8 : 0);
    if (input & ~this.lastInput) this.prologue.skip();
    this.lastInput = input;
    this.updatePipes(now);
    this.pell.update(dt);
    this.echo.update(dt);
    this.prologue.update();
    this.escape.update(dt);
    this.buildView(now);
  }

  private updatePipes(now: number): void {
    const ctx = this.ctx;
    const rt = ctx.levels.current;
    const id = this.levelId();
    const biome = this.biome();
    const pipes = rt?.story?.pipes;
    // A line that was cut before it began: the pipe (and its beat) wait for the next passer-by.
    const pending = this.pendingPipe;
    if (pending && now > pending.until) {
      this.pendingPipe = null;
      this.state = { ...this.state, pipes: this.state.pipes.filter(k => k !== pending.key), spoken: this.state.spoken.filter(b => b !== pending.beat) };
      this.pipeGlow.delete(pending.key);
    }
    if (!rt || !id || !biome || !pipes?.length || ctx.player.dead || (ctx.state.frameCount % 6) !== 0) return;
    const p = ctx.player;
    // Passing under a pipe ARMS it: if the air is taken just then (the floor's arrival, another
    // line), it speaks as soon as it is free, while you are still within earshot.
    for (const pipe of pipes) {
      if (Math.abs(p.x - pipe.x) <= PIPE_REACH_X && p.y >= pipe.floorY - PIPE_REACH_UP && p.y <= pipe.floorY + 10) this.pipeArmed.set(pipe.id, now + PIPE_ARMED_S);
    }
    // Never over a scripted beat: the arrival, the echo, Pell or a cinematic has the floor.
    if (now < this.pipesQuietUntil || this.pendingPipe || this.echo.active || this.pell.talking || this.cinema.active || this.escape.active) return;
    if (ctx.narrator?.busy) return;
    const script = DOCENT_PIPES[biome];
    for (const pipe of pipes) {
      const armed = this.pipeArmed.get(pipe.id) ?? 0;
      if (armed < now || Math.hypot(p.x - pipe.x, p.y - pipe.floorY) > PIPE_EARSHOT) continue;
      const line = pipeLine(script, pipe, id, this.state, this.meta());
      if (!line) {
        // Nothing left to say here this run: the pipe keeps quiet (and stops being asked).
        this.state = withPipeSpoken(this.state, id, pipe, null);
        this.pipeArmed.delete(pipe.id);
        continue;
      }
      const key = `${id}:${pipe.id}`;
      // Pending BEFORE speaking: a caption-only line begins (and confirms itself) inside speak().
      this.pendingPipe = { key, levelId: id, pipeId: pipe.id, text: line.text, beat: line.beat.id, biome, until: now + 4.5 };
      this.pipeGlow.set(key, now + this.lineSeconds({ speaker: 'docent', text: line.text }) + 0.8);
      this.state = withPipeSpoken(this.state, id, pipe, line.beat.id);
      this.pipeArmed.delete(pipe.id);
      const ok = this.say([{ speaker: 'docent', text: line.text }], { priority: 'normal', source: 'pipe', ttlMs: 4000, captioned: true, repeatable: true });
      if (!ok) {
        this.pendingPipe = null;
        this.pipeGlow.delete(key);
        this.state = { ...this.state, pipes: this.state.pipes.filter(k => k !== key), spoken: this.state.spoken.filter(b => b !== line.beat.id) };
        continue;
      }
      ctx.audio.sfx('mech.shrine', pipe.x, pipe.floorY - 24);
      ctx.particles.burst(pipe.x, pipe.floorY - 20, 6, null, () => 0xc8b894, 0.5, { grav: -0.01 });
      break;
    }
  }

  private buildView(now: number): void {
    const rt = this.ctx.levels.current;
    const st = rt?.story;
    const v = this.renderView;
    const id = this.levelId() ?? '';
    v.pipes = (st?.pipes ?? []).map(p => {
      const until = this.pipeGlow.get(`${id}:${p.id}`) ?? 0;
      return { x: p.x, top: p.top, floorY: p.floorY, speaking: Math.max(0, Math.min(1, (until - now) / 0.6)), spoken: this.state.pipes.includes(`${id}:${p.id}`) };
    });
    const biome = this.biome();
    v.camp = st?.camp ? {
      ...st.camp,
      lit: biome !== 'volcanic',
      abandoned: biome === 'volcanic',
      pageRead: this.state.pell[id]?.gift === 'page' && biome === 'volcanic',
    } : null;
    v.pell = this.pell.view();
    v.valve = st?.valve ? { ...st.valve, ...this.echo.valveView() } : null;
    v.echo = this.echo.view();
    const flue = this.escape.site ?? st?.flue ?? null;
    v.flue = flue ? { ...flue, open: this.escape.active || this.state.escape !== 'none', heat: this.escape.heat, lava: this.escape.lava } : null;
    v.prompt = this.cinema.active ? null : this.pell.prompt() ?? this.echo.prompt();
  }

  get view(): StoryRenderView { return this.renderView; }

  /* ---------------- interaction ---------------- */

  interact(): boolean {
    if (this.ctx.state.mode !== 'play' || this.ctx.player.dead || this.cinema.active) return false;
    return this.pell.interact() || this.echo.interact();
  }

  dialogueAdvance(): void { this.pell.advance(); }
  dialogueChoose(index: number): void { this.pell.choose(index); }
  dialogueClose(): void { this.pell.close(); }

  skipCinematic(): void { this.cinema.skip(); }

  get cinematic(): 'opening' | 'ending' | null { return this.cinema.active; }

  /**
   * A scripted beat has the stage: lessons and hint lines wait (ui/HintTeachOverlay,
   * game/Hints). QA watched "The Flask" pop mid-escape, land on the Leviathan's
   * prologue, and "The Grimoire Watches" cover Pell's first line.
   */
  get beatActive(): boolean {
    const src = this.ctx.narrator?.speakingSource ?? null;
    return this.cinema.active !== null || this.escape.active || this.pell.talking || this.echo.active || this.prologue.active
      || src === 'sanctum-ash' || src === 'prologue' || src === 'escape' || src === 'echo';
  }

  /* ---------------- the escape ---------------- */

  get escapeActive(): boolean { return this.escape.active; }

  beginEscape(): boolean {
    return this.escape.begin(() => this.onEscaped());
  }

  respawnPoint(): { x: number; y: number } | null {
    return this.escape.respawnPoint();
  }

  /** Out of the flue: the ending, then the Ledger (RunDirector ends the run on `runComplete`). */
  private onEscaped(): void {
    const ctx = this.ctx;
    const first = this.meta().endings.waiting + this.meta().endings.lantern === 0;
    const script = first ? ENDING_FIRST : ENDING_AGAIN;
    const waiting = pellWaits(this.state);
    const plates: Plate[] = [script.rise, script.town, waiting ? script.pellWaiting : script.pellLantern, script.farewell];
    this.updateMeta(m => withJournal({ ...m, endings: { waiting: m.endings.waiting + (waiting ? 1 : 0), lantern: m.endings.lantern + (waiting ? 0 : 1) } }, 'journal.ending'));
    const finish = (): void => {
      ctx.events.emit('runComplete', { gold: ctx.state.score });
      // A finished run has nothing left to resume (RunDirector retires the save too).
      ctx.levels.abandonExpedition();
    };
    void this.cinema.play('ending', plates, { pause: true }).then(finish);
  }

  /* ---------------- the opening ---------------- */

  get openingSeen(): boolean { return this.store.data.openingSeen; }

  playOpening(opts: { replay?: boolean } = {}): Promise<void> {
    const inGame = this.ctx.state.mode === 'play' && !opts.replay;
    if (!opts.replay) this.updateMeta(m => ({ ...m, openingSeen: true }));
    return this.cinema.play('opening', OPENING, { pause: inGame, maxSeconds: OPENING_MAX_SECONDS });
  }

  /* ---------------- the Sanctum (Matron Ash) ---------------- */

  sanctumOpened(nextBiome: string | null): void {
    this.sanctumDoors.clear();
    const floor = floorOf(this.levelId());
    const greet = ASH_GREETINGS[floor];
    const lines: StorySpokenLine[] = [];
    const beats: string[] = [];
    if (greet) {
      const line = beatLine(this.meta(), greet);
      if (line) { lines.push({ speaker: 'ash', text: line.text }); beats.push(greet.id); }
    }
    if (nextBiome) {
      const door = ASH_DOORS[nextBiome as BiomeId];
      if (door && !this.sanctumDoors.has(nextBiome)) {
        const line = beatLine(this.meta(), door);
        if (line) { lines.push({ speaker: 'ash', text: line.text }); beats.push(door.id); this.sanctumDoors.add(nextBiome); }
      }
    }
    if (lines.length) {
      // She waits for the Docent's line to finish (QA: her high priority cut his last pipe line),
      // and says her greeting and the door's line together only when both are short: the
      // pair ran 15-16 s and talked on into the next floor. A door line left out is said
      // when he looks at the door (sanctumDoor).
      if (lines.length > 1 && lines.reduce((s, l) => s + this.lineSeconds(l), 0) > ASH_MAX_S) {
        lines.length = 1;
        beats.length = 1;
        if (nextBiome) this.sanctumDoors.delete(nextBiome);
      }
      this.say(lines, { priority: 'normal', source: 'sanctum-ash', ttlMs: 12000, captioned: false, repeatable: true, beats });
      this.updateMeta(m => withJournal(m, 'journal.ash'));
    }
  }

  sanctumDoor(biome: string): void {
    if (this.sanctumDoors.has(biome)) return;
    const door = ASH_DOORS[biome as BiomeId];
    if (!door) return;
    const line = beatLine(this.meta(), door);
    if (!line) return;
    this.sanctumDoors.add(biome);
    // Queued behind her greeting if he looks at the door while she is still speaking.
    this.say([{ speaker: 'ash', text: line.text }], { priority: 'normal', source: 'sanctum-ash', ttlMs: 10000, captioned: false, repeatable: true, beats: [door.id] });
  }

  /* ---------------- the Journal ---------------- */

  journal(): StoryJournalPage[] {
    const meta = this.meta();
    return journalEntries().map(e => {
      const heardLines = e.lines.filter(l => !l.beat || meta.heard.includes(l.beat));
      const unlocked = meta.journal.includes(e.id) || (e.kind === 'docent' && heardLines.length > 0);
      const lines = unlocked ? heardLines.map(l => ({ speaker: l.speaker, text: l.text })) : [];
      return {
        id: e.id, kind: e.kind, title: e.title, unlocked, lines, missing: e.lines.length - lines.length,
        group: e.biome ? STORY_FLOOR_NAMES[e.biome] ?? e.biome : e.kind === 'ash' ? 'The Sanctum' : 'The top of the flue',
      };
    });
  }

  readJournal(id: string): boolean {
    const page = this.journal().find(p => p.id === id);
    if (!page?.unlocked || page.lines.length === 0) return false;
    this.ctx.narrator?.cutSource?.('journal');
    return this.say(page.lines, { priority: 'high', source: 'journal', ttlMs: 4000, captioned: false, repeatable: true });
  }

  stopReading(): void {
    this.ctx.narrator?.cutSource?.('journal');
  }

  /* ---------------- probes ---------------- */

  /** Read the story meta (probes, the Journal). */
  metaData(): Readonly<StoryMetaData> { return this.meta(); }

  /** Probes: set the meta for a scenario (a repeat visitor, a veteran). Untracked runs only touch the session copy. */
  debugSetMeta(patch: Partial<StoryMetaData>): void {
    this.updateMeta(m => ({ ...defaultStoryMeta(), ...m, ...patch }));
  }

  debugSnapshot(): Record<string, unknown> {
    return {
      tracked: this.tracked,
      run: structuredClone(this.state),
      meta: { runsBegun: this.meta().runsBegun, heard: this.meta().heard.length, pellRuns: this.meta().pellRuns, openingSeen: this.meta().openingSeen, journal: [...this.meta().journal] },
      pell: this.pell.debug(),
      echo: this.echo.debug(),
      prologue: this.prologue.debug(),
      escape: this.escape.debug(),
      cinematic: this.cinema.active,
      prompt: this.renderView.prompt,
    };
  }
}

import type { StoryCampDress, StoryCampSite, StoryDialogueView, StoryFigureView } from '@/core/story';
import type { CardId, LevelRuntime } from '@/core/types';
import {
  PELL,
  PELL_BARKS,
  PELL_LAST_PAGE,
  PELL_SECOND_TALK,
  SPEAKER_NAMES,
  type PellChoice,
  type PellGift,
  type PellVisit,
  type StoryBiome,
} from '@/content/story';
import { buildCardOffer, collectOwnedCards, SANCTUM_LOST_PAGES_POOL, TOME_REWARD_POOL, withDiscoveredCards } from '@/combat/wands/rewardPools';
import { getDiscoveredCards } from '@/combat/wands/cardDiscovery';
import { fxRandom } from '@/core/simRandom';
import { Cell } from '@/sim/CellType';
import { beatHeard, pellRecognition, withHeard } from './storyMeta';
import type { StoryHost } from './host';
import { glowseedCap, GLOWSEED_POUCH_MAX } from '@/game/glowseeds';
import {
  barkKey, campDress, giftHint, isTold, menuFor, mouthOpen, noticeHeardId, noticeKey, onceKey, pickDifferent, pickNotice, pinPostscript,
  PIN_REACH, teaUnneeded, withTold,
} from './pellRules';
import { pickIdle, seededRandom } from './pellIdle';

/**
 * PELL, at his camp (wave 3 WS-S). A figure on the story rig in a surveyor's
 * long coat, a map case on his back and a lantern on a pole; between visits
 * he sketches his map, warms his hands, sips his tea, rubs the cold out of his
 * fingers, checks the map against the wall and startles at loud noises. He
 * turns to face the apprentice who comes near: his eyes first, the rest of
 * him a moment after.
 *
 * Talking (E) opens the dialogue box: his greeting line by line (voiced; the
 * text types on in step), a NOTICE about the run if he has one, then up to
 * three choices, a reply, his gift, and a farewell. It never pauses the run;
 * Esc, a click away or walking off ends it. The camera eases to a two-shot of
 * the pair for the talk. On the Kiln his camp is cold: he has gone ahead, and
 * his last map page lies on the bedroll (E reads it, in his voice).
 *
 * Beside the camp he notices things (a fire near it, a hostile in sight, a
 * corpse carried in, a long silence, a wound) and says so in a caption, once
 * a run each; his compass mark pays off when the apprentice reaches it.
 */

/** Reach for the prompt and for talking (cells from Pell's feet). */
const TALK_REACH = 28;
/** He notices you within this, and turns to look. */
const NOTICE = 110;
/** Walk this far off and the conversation ends. */
const LEAVE = 64;
/** The body follows the eyes by this long when he turns to someone (s). */
const TURN_DELAY = 0.25;
/** Seconds between looks at the world for barks and the pin (accumulated dt, not a frame count). */
const SCAN_S = 0.1;
/** Barks speak only to an apprentice within this of the camp (cells). */
const BARK_X = 190;
const BARK_Y = 100;
/** Seconds between one bark and the next, and before the first on a floor. */
const BARK_GAP_S = 14;
const BARK_ARRIVAL_S = 6;
/** A fire counts within this of the camp, when this many cells burn. */
const FIRE_REACH = 40;
const FIRE_CELLS = 3;
/** He lingers without a word this long before he speaks up (s), standing within LINGER_X of him. */
const LINGER_S = 8;
const LINGER_X = 44;
/** A hostile counts in sight of the camp within this. */
const HOSTILE_X = 150;
const HOSTILE_Y = 80;
/** Hurt, for the bark. */
const HURT_BARK = 0.3;
/** A noise this big (of 1) is noticed even beyond where it would make him jump, up to FAR_EXTRA further (cells). */
const BIG_NOISE = 1;
const FAR_EXTRA = 220;
/** He sees an apprentice fall within this (cells). */
const WITNESS_REACH = 140;
/** An unrecorded line runs at this fraction of a caption's reading time. */
const TEXT_PACE = 0.65;
/** The two-shot's gentle push-in. */
const TWO_SHOT_ZOOM = 1.14;

type Phase = 'idle' | 'greet' | 'choose' | 'reply' | 'farewell';

interface Talk {
  visit: PellVisit;
  phase: Phase;
  /** Lines left to say in this phase, and the one on screen. */
  queue: string[];
  line: string;
  /** Wall time the current line began, and the seconds it takes (his mouth follows this clock). */
  lineStart: number;
  lineSecs: number;
  /** Wall time the current line ends (voice or reading pace). */
  lineEnds: number;
  /** Wall time the box finishes typing it (E before then shows it whole instead of moving on). */
  typedBy: number;
  instant: boolean;
  choices: readonly PellChoice[];
  /** After the reply: back to the menu (a choice that only talks, a refused tea) rather than on to the farewell. */
  back: boolean;
  /** What he says last: the visit's farewell the first time, a fresh turn of phrase after. */
  farewell: string;
  /** The page on the Kiln (a note, not a conversation). */
  page: boolean;
  /** Health when the talk opened: a wound during it hands the camera back. */
  hp: number;
  noFrame: boolean;
}

/** A reaction to something near the camp: an act for a while, facing and looking where it happened. */
interface React {
  act: string;
  until: number;
  face: 1 | -1 | null;
  look: { x: number; y: number } | null;
  /** What he does once this is over (a startle, then he kneels). */
  then?: { act: string; seconds: number };
}

/** The enemy kinds that have a line of their own (the rest get the general one). */
const HOSTILE_LINE: Readonly<Record<string, keyof typeof PELL_BARKS.hostile>> = { slime: 'slime', acidslime: 'slime', bat: 'bat', weaver: 'weaver' };
/** Not worth a bark: a clutch of eggs does not move, a boss has its own entrance. */
const NO_BARK_KINDS: ReadonlySet<string> = new Set(['eggs', 'colossus', 'leviathan', 'rimewarden', 'lenswright']);

export class PellCamp {
  private talk: Talk | null = null;
  idleAct = 'sketch';
  idleUntil = 0;
  private actT = 0;
  private startleUntil = 0;
  private waved = false;
  private facing: 1 | -1 = 1;
  /** He has been put at his camp facing its way (on arrival, before any turning to you). */
  private placed = false;
  private turnAt = 0;
  private react: React | null = null;
  private scanT = 0;
  private lingerT = 0;
  private barkQuietUntil = 0;
  private arrivedAt = 0;
  private idleRand: () => number = seededRandom(7);
  private lastSecond: { bye: string | null; menu: string | null } = { bye: null, menu: null };
  /** The two-shot (the camera's action focus is this very object while it is ours). */
  private readonly focus = { x: 0, y: 0, zoom: TWO_SHOT_ZOOM };
  private readonly figure: StoryFigureView = {
    x: 0, y: 0, facing: 1, costume: 'surveyor', act: 'sketch', actT: 0, stride: 0, alpha: 1, ghost: false, lookX: null, lookY: null, seed: 7,
  };

  constructor(private readonly host: StoryHost) {}

  /** This floor's key in the run's record of Pell. */
  private get levelKey(): string { return this.host.levelId() ?? ''; }

  /** Pell's camp on this floor, and whether he is at it (not on the Kiln: he has gone ahead). */
  private site(): { camp: StoryCampSite; present: boolean; biome: string } | null {
    const rt = this.host.ctx.levels.current;
    const camp = rt?.story?.camp;
    const biome = this.host.biome();
    if (!rt || !camp || !biome || this.host.floor() <= 0) return null;
    return { camp, present: biome !== 'volcanic' && PELL[biome] !== undefined, biome };
  }

  /** A loud noise near the camp: he jumps. A big one further off: he peers toward it. */
  noise(x: number, y: number, strength: number): void {
    const s = this.site();
    if (!s?.present || this.talk) return;
    const d = Math.hypot(x - s.camp.x, y - s.camp.floorY), reach = 160 + strength * 120;
    if (d > reach) {
      if (strength >= BIG_NOISE && d <= reach + FAR_EXTRA) this.react = { act: 'lookup', until: this.host.now() + 2, face: x >= s.camp.x ? 1 : -1, look: { x, y: y - 20 } };
      return;
    }
    this.startleUntil = this.host.now() + 0.9;
    this.actT = 0;
  }

  /** The apprentice died within sight of the camp: he jumps, then kneels where they fell. */
  witnessDeath(): void {
    const s = this.site();
    const p = this.host.ctx.player;
    if (!s?.present || Math.hypot(p.x - s.camp.x, p.y - s.camp.floorY) > WITNESS_REACH) return;
    const now = this.host.now();
    const face: 1 | -1 = p.x >= s.camp.x ? 1 : -1;
    this.react = { act: 'startle', until: now + 0.9, face, look: { x: p.x, y: p.y - 6 }, then: { act: 'kneel', seconds: 3 } };
    this.actT = 0;
  }

  levelChanged(): void {
    this.close(false);
    this.waved = false;
    this.react = null;
    this.placed = false;
    this.lingerT = 0;
    this.arrivedAt = this.host.now();
    this.idleUntil = 0;
    // The same camp always idles the same way for a given run (and a test can rely on it).
    this.idleRand = seededRandom(hash(`${this.levelKey}:${this.host.run().runIndex}`));
  }

  inReach(): boolean {
    const s = this.site();
    if (!s) return false;
    const p = this.host.ctx.player;
    const reach = s.present ? TALK_REACH : TALK_REACH + 6;
    return !p.dead && Math.abs(p.x - s.camp.x) <= reach && p.y > s.camp.floorY - 40 && p.y < s.camp.floorY + 12;
  }

  prompt(): { x: number; y: number; verb: string } | null {
    const s = this.site();
    if (!s || this.talk || !this.inReach()) return null;
    const run = this.host.run();
    if (!s.present) return run.pell[this.levelKey]?.gift === 'page' ? null : { x: s.camp.x, y: s.camp.floorY - 20, verb: 'Read the page' };
    return { x: s.camp.x, y: s.camp.floorY - 30, verb: 'Talk to Pell' };
  }

  get talking(): boolean { return this.talk !== null; }

  /** What has accrued at the camp this run (the story layer draws it). */
  dress(): StoryCampDress | undefined {
    const s = this.site();
    if (!s) return undefined;
    return campDress(this.host.run(), this.host.floor(), s.biome);
  }

  /** E in reach: open the conversation (or read the page), or skip to the next line. */
  interact(): boolean {
    if (this.talk) { this.advance(); return true; }
    const s = this.site();
    if (!s || !this.inReach()) return false;
    if (!s.present) return this.readPage();
    const pell = PELL[s.biome as keyof typeof PELL];
    if (!pell) return false;
    const run = this.host.run();
    const here = run.pell[this.levelKey];
    const meta = this.host.meta();
    let visit: PellVisit;
    if (!beatHeard(meta, pell.first.id)) visit = pell.first;
    else visit = pellRecognition(meta) === 'veteran' && pell.veteran ? pell.veteran : pell.again;
    const first = !here?.met;
    const gifted = !!here?.gift;
    const choices = menuFor(visit, run, gifted);
    const greet: string[] = [];
    let farewell = visit.farewell;
    if (first) {
      greet.push(...visit.greet);
      // One line about the run, after the greeting (never on the very first meeting: that is the introduction).
      if (visit.id !== PELL.earthen?.first.id) {
        const notice = pickNotice(this.host.facts(), s.biome as StoryBiome, run, meta.heard);
        if (notice) {
          greet.push(notice.text);
          this.host.setRun(withTold(this.host.run(), noticeKey(notice.id)));
          if (notice.ever) this.host.updateMeta(m => withHeard(m, noticeHeardId(notice.id)));
        }
      }
    } else {
      // Back on the same floor: a fresh turn of phrase, never the last one, and the menu if he still has one.
      farewell = this.pickSecond('bye', s.biome as StoryBiome);
      if (choices.length) greet.push(this.pickSecond('menu', s.biome as StoryBiome));
    }
    const hp = this.host.ctx.player.hp;
    this.talk = {
      visit, phase: greet.length ? 'greet' : 'farewell', queue: greet.length ? greet : [farewell], line: '', lineStart: 0, lineSecs: 0, lineEnds: 0, typedBy: 0, instant: false,
      choices, back: false, farewell, page: false, hp, noFrame: false,
    };
    if (first) {
      const firstThisRun = !Object.values(this.host.run().pell).some(v => v.met);
      const cur = this.host.run();
      this.host.setRun({ ...cur, pell: { ...cur.pell, [this.levelKey]: { met: true, gift: here?.gift ?? null } } });
      this.host.updateMeta(m => ({
        ...m,
        pellRuns: firstThisRun ? m.pellRuns + 1 : m.pellRuns,
        heard: m.heard.includes(visit.id) ? m.heard : [...m.heard, visit.id],
      }));
      this.host.unlockJournal(`journal.pell.${s.biome}`);
    }
    this.lingerT = 0;
    this.nextLine();
    return true;
  }

  /** A second turn of phrase on this floor, different from the last of its kind. */
  private pickSecond(kind: 'bye' | 'menu', biome: StoryBiome): string {
    const pool = kind === 'bye' ? [...PELL_SECOND_TALK.bye, ...(PELL_SECOND_TALK.floor[biome] ?? [])] : PELL_SECOND_TALK.menu;
    const line = pickDifferent(pool, this.lastSecond[kind], fxRandom);
    this.lastSecond[kind] = line;
    return line;
  }

  private readPage(): boolean {
    const run = this.host.run();
    const meta = this.host.meta();
    const heard = beatHeard(meta, PELL_LAST_PAGE.first.id);
    const page = heard ? PELL_LAST_PAGE.again : PELL_LAST_PAGE.first;
    const ps = pinPostscript(run, heard);
    this.talk = {
      visit: { id: page.id, greet: [], choices: [], farewell: '' }, phase: 'reply', queue: [...page.lines, ...(ps ? [ps] : [])], line: '', lineStart: 0, lineSecs: 0,
      lineEnds: 0, typedBy: 0, instant: false, choices: [], back: false, farewell: '', page: true, hp: this.host.ctx.player.hp, noFrame: true,
    };
    this.host.setRun({ ...run, pell: { ...run.pell, [this.levelKey]: { met: run.pell[this.levelKey]?.met ?? false, gift: 'page' } } });
    this.host.updateMeta(m => (m.heard.includes(page.id) ? m : { ...m, heard: [...m.heard, page.id] }));
    this.host.unlockJournal('journal.pell.volcanic');
    this.nextLine();
    return true;
  }

  /** Show the line whole if it is still typing; else go on to the next line. */
  advance(): void {
    const t = this.talk;
    if (!t) return;
    if (t.phase === 'choose') return;
    if (this.host.now() < t.typedBy && !t.instant) {
      t.instant = true;
      this.publish(t);
      return;
    }
    this.host.ctx.narrator?.cutSource?.('pell');
    this.nextLine();
  }

  choose(index: number): void {
    const t = this.talk;
    if (!t || t.phase !== 'choose') return;
    const choice = t.choices[index];
    if (!choice) return;
    const rest = t.choices.filter(c => c !== choice);
    t.phase = 'reply';
    // The tea is not spent on someone in rude health: he declines, and the menu stays.
    if (choice.gift === 'tea' && choice.refuse && teaUnneeded(this.hpFrac())) {
      t.queue = [...choice.refuse];
      t.choices = rest;
      t.back = rest.length > 0;
      this.nextLine();
      return;
    }
    t.queue = [...choice.reply];
    if (choice.once) this.host.setRun(withTold(this.host.run(), onceKey(choice.once)));
    if (choice.gift) {
      // The gift is exclusive: one a floor, and the visit ends on it.
      this.give(choice.gift);
      t.choices = [];
      t.back = false;
    } else {
      // A choice that only talks: back to the menu for the rest.
      t.choices = rest;
      t.back = rest.length > 0;
    }
    this.nextLine();
  }

  close(publish = true): void {
    this.releaseFrame();
    if (!this.talk) return;
    this.talk = null;
    this.host.ctx.narrator?.cutSource?.('pell');
    if (publish) this.publish(null);
  }

  private hpFrac(): number {
    const p = this.host.ctx.player;
    return p.maxHp > 0 ? p.hp / p.maxHp : 1;
  }

  private nextLine(): void {
    const t = this.talk;
    if (!t) return;
    const text = t.queue.shift();
    if (text === undefined) {
      if (t.phase === 'greet') {
        if (t.choices.length) { t.phase = 'choose'; t.line = t.line || ''; this.publish(t); return; }
        t.phase = 'farewell';
        t.queue = t.farewell ? [t.farewell] : [];
        this.nextLine();
        return;
      }
      if (t.phase === 'reply' && !t.page) {
        if (t.back && t.choices.length) { t.back = false; t.phase = 'choose'; this.publish(t); return; }
        t.phase = 'farewell';
        t.queue = t.farewell ? [t.farewell] : [];
        this.nextLine();
        return;
      }
      this.close();
      return;
    }
    t.line = text;
    const line = { speaker: 'pell' as const, text };
    // A line with no recording is read, not spoken: a quicker pace than a caption's, so a notice does not hold up the menu.
    const seconds = this.host.voiced(line) ? this.host.lineSeconds(line) : Math.max(2, this.host.lineSeconds(line) * TEXT_PACE);
    // His lines are spoken; the box shows the words (no caption of their own).
    this.host.say([line], { priority: 'high', source: 'pell', ttlMs: 4000, captioned: false, repeatable: true });
    t.lineStart = this.host.now();
    t.lineSecs = seconds;
    t.lineEnds = this.host.now() + seconds + 0.45;
    t.typedBy = this.host.now() + Math.max(0.6, seconds * 0.92);
    t.instant = false;
    this.publish(t);
  }

  private publish(t: Talk | null): void {
    const s = this.site();
    const choosing = !!t && t.phase === 'choose';
    const hp = this.hpFrac();
    const view: StoryDialogueView = t && s
      ? {
        open: true, speaker: 'pell', name: t.page ? 'Pell’s last page' : SPEAKER_NAMES.pell, text: t.line,
        seconds: Math.max(0.6, t.lineEnds - this.host.now() - 0.45), instant: t.instant || choosing, choices: choosing ? t.choices.map(c => c.label) : [],
        hints: choosing ? t.choices.map(c => giftHint(c, hp)) : [],
        x: s.camp.x, y: s.camp.floorY - 22,
      }
      : { open: false, speaker: 'pell', name: SPEAKER_NAMES.pell, text: '', seconds: 0, choices: [], x: 0, y: 0 };
    this.host.ctx.events.emit('storyDialogue', view);
  }

  /** Hand over the gift. Every gift is real: a compass mark on a real secret, a card, glowseeds, health. */
  private give(gift: PellGift): void {
    const ctx = this.host.ctx;
    const rt = ctx.levels.current;
    const run = this.host.run();
    this.host.setRun({ ...run, pell: { ...run.pell, [this.levelKey]: { met: true, gift } } });
    if (!rt) return;
    if (gift === 'seeds' && rt.living) {
      // A full pouch (the Warm Refuge refills it, and his camp is beside it) used to
      // make the gift nothing at all: then the pouch grows to take them.
      const cap = glowseedCap(rt.living);
      if (rt.living.glowseeds >= cap && cap < GLOWSEED_POUCH_MAX) {
        rt.living.glowseedCap = cap + 1;
        rt.living.glowseeds = cap + 1;
        ctx.events.emit('toast', { text: `Pell’s glowseeds, and a bigger pouch: ${cap + 1} in it.` });
      } else {
        rt.living.glowseeds = Math.max(rt.living.glowseeds, cap);
        ctx.events.emit('toast', { text: `Pell’s glowseeds: ${rt.living.glowseeds} in the pouch.` });
      }
      ctx.audio.sfx('player.glowseed');
    } else if (gift === 'tea') {
      ctx.player.hp = ctx.player.maxHp;
      ctx.events.emit('toast', { text: 'Pell’s last tea. Health restored.' });
      ctx.audio.sfx('player.heal');
    } else if (gift === 'page') {
      const pool = withDiscoveredCards([...TOME_REWARD_POOL, ...SANCTUM_LOST_PAGES_POOL], getDiscoveredCards());
      const [card] = buildCardOffer(pool, collectOwnedCards(ctx.wands), { count: 1, ensureKind: 'projectile' }) as CardId[];
      if (card) { ctx.wands.grantCard(ctx, card); ctx.audio.learn(); }
    } else if (gift === 'pin') {
      const mark = secretMark(rt, this.site()?.camp ?? null);
      if (mark) {
        rt.mapWaypoint = { x: mark.x, y: mark.y, label: 'Pell’s mark' };
        // He will want to know if it paid: remember where, and how many pickups near it were already taken.
        this.host.setRun({ ...this.host.run(), pin: { level: this.levelKey, x: mark.x, y: mark.y, taken: takenNear(rt, mark.x, mark.y) } });
        ctx.events.emit('toast', { text: 'Compass: Pell’s mark' });
      } else {
        // Nothing sealed on this floor: the gift becomes a page instead.
        this.give('page');
      }
    }
  }

  /* ---------------- the tick ---------------- */

  /** The tick: idle life, turning to the apprentice, the conversation's pace and its walking-away end. */
  update(dt: number): void {
    const s = this.site();
    const f = this.figure;
    if (!s || !s.present) {
      // The cold camp's page is read line by line with E; walking off from it ends it too.
      const away = s && this.talk?.page && (this.host.ctx.player.dead || Math.abs(this.host.ctx.player.x - s.camp.x) > LEAVE + 20);
      if (away || (!s && this.talk)) this.close();
      this.releaseFrame();
      return;
    }
    const ctx = this.host.ctx;
    const p = ctx.player;
    const now = this.host.now();
    const near = !p.dead && Math.hypot(p.x - s.camp.x, p.y - s.camp.floorY) < NOTICE;
    this.actT += dt;
    // Conversation: lines advance on their own when said; walking off ends it.
    const t = this.talk;
    if (t) {
      if (p.dead || Math.abs(p.x - s.camp.x) > LEAVE || Math.abs(p.y - s.camp.floorY) > 70) { this.close(); }
      else if (t.phase !== 'choose' && now >= t.lineEnds) this.nextLine();
    }
    // A look at the world a few times a second: his barks, and whether his mark has paid.
    this.scanT += dt;
    if (this.scanT >= SCAN_S) {
      const span = this.scanT;
      this.scanT = 0;
      this.scan(s, now, span);
    }
    // What he is doing.
    let act: string;
    if (this.react && now >= this.react.until && this.react.then) {
      // One reaction leads to the next: the start, then the kneel.
      const { act: nextAct, seconds } = this.react.then;
      this.react = { act: nextAct, until: now + seconds, face: this.react.face, look: this.react.look };
      this.actT = 0;
    }
    const react = this.react && now < this.react.until ? this.react : null;
    if (now < this.startleUntil) act = 'startle';
    else if (react) act = react.act;
    else if (this.talk) act = this.talk.phase === 'choose' ? 'stand' : 'talk';
    else if (near && !this.waved) {
      act = 'wave';
      if (this.actT > 1.4) { this.waved = true; this.actT = 0; }
    } else {
      if (now >= this.idleUntil) {
        const next = pickIdle(this.idleAct, s.biome, this.idleRand);
        this.idleAct = next.act;
        this.idleUntil = now + next.seconds;
        this.actT = 0;
      }
      act = near && this.idleAct === 'lookup' ? 'stand' : this.idleAct;
    }
    if (act !== f.act) this.actT = 0;
    // He looks at you at once when you are near (or at what he has seen), and turns his body a moment after.
    if (!this.placed) { this.placed = true; this.facing = s.camp.facing; this.turnAt = 0; }
    const toward: 1 | -1 | null = react?.face ?? (near || this.talk ? (p.x >= s.camp.x ? 1 : -1) : null);
    const want = toward ?? s.camp.facing;
    if (want === this.facing) this.turnAt = 0;
    else if (this.turnAt === 0) this.turnAt = now + (toward !== null ? TURN_DELAY : TURN_DELAY * 1.6);
    if (this.turnAt !== 0 && now >= this.turnAt) { this.facing = want; this.turnAt = 0; }
    f.x = s.camp.x; f.y = s.camp.floorY; f.facing = this.facing; f.headFacing = want; f.act = act; f.actT = this.actT;
    const look = react?.look ?? (near || this.talk ? { x: p.x, y: p.y - 12 } : null);
    f.lookX = look ? look.x : null; f.lookY = look ? look.y : null;
    f.mouth = this.mouthNow(now);
    f.bandaged = this.host.floor() >= 3;
    this.frame(s);
  }

  /** His mouth follows the line being said; undefined when he is not speaking (the rig's own chatter). */
  private mouthNow(now: number): number | undefined {
    const t = this.talk;
    if (!t || t.phase === 'choose' || t.line === '') return undefined;
    return mouthOpen(t.line, (now - t.lineStart) / Math.max(0.3, t.lineSecs));
  }

  /* ---------------- the two-shot ---------------- */

  /** Ease the camera to the pair of them for the talk (a wound, a shot of someone else's, or reduced motion, leaves it alone). */
  private frame(s: { camp: StoryCampSite }): void {
    const ctx = this.host.ctx;
    const cam = ctx.camera;
    const t = this.talk;
    const p = ctx.player;
    if (!cam || !t) { this.releaseFrame(); return; }
    if (p.hp < t.hp) t.noFrame = true;
    t.hp = p.hp;
    if (t.noFrame || t.page || p.dead || ctx.state?.reduceCameraShake) { this.releaseFrame(); return; }
    // The tea engine or a boss's entrance has the camera: it keeps it.
    if (cam.actionFocus && cam.actionFocus !== this.focus) return;
    this.focus.x = (p.x + s.camp.x) / 2;
    // A little below the pair, so they sit above the dialogue box.
    this.focus.y = Math.min(p.y, s.camp.floorY) - 4;
    cam.actionFocus = this.focus;
  }

  private releaseFrame(): void {
    const cam = this.host.ctx.camera;
    if (cam && cam.actionFocus === this.focus) cam.actionFocus = null;
  }

  /* ---------------- barks, and the mark ---------------- */

  private scan(s: { camp: StoryCampSite }, now: number, span: number): void {
    const ctx = this.host.ctx;
    const rt = ctx.levels.current;
    const p = ctx.player;
    if (!rt) return;
    // His mark pays off when a pickup near it has been taken since he gave it.
    const run = this.host.run();
    const pin = run.pin;
    if (pin && pin.level === this.levelKey && takenNear(rt, pin.x, pin.y) > pin.taken) {
      this.host.setRun({ ...run, pin: null, pinsPaid: run.pinsPaid.includes(pin.level) ? run.pinsPaid : [...run.pinsPaid, pin.level] });
    }
    // Barks: only to someone on the same screen, never over a conversation, a line or a rest.
    if (p.dead || this.talk || !ctx.state || ctx.state.mode !== 'play') { this.lingerT = 0; return; }
    const dx = Math.abs(p.x - s.camp.x), dy = Math.abs(p.y - s.camp.floorY);
    const here = this.host.run().pell[this.levelKey];
    if (dx <= LINGER_X && dy <= 30 && !here?.met && (this.host.meta().pellRuns > 0 || Object.values(this.host.run().pell).some(v => v.met))) this.lingerT += span;
    else this.lingerT = 0;
    if (dx > BARK_X || dy > BARK_Y || now < this.barkQuietUntil || now < this.arrivedAt + BARK_ARRIVAL_S || ctx.narrator?.busy) return;
    const told = (id: string): boolean => isTold(this.host.run(), barkKey(id));
    const fire = !told(PELL_BARKS.fire.id) && this.fireNear(s.camp);
    if (fire) { this.bark(PELL_BARKS.fire, 'startle', 0.9, null, null); return; }
    if (!told(PELL_BARKS.corpse.id) && this.host.carryingCorpse()) { this.bark(PELL_BARKS.corpse, 'kneel', 2.6, p.x >= s.camp.x ? 1 : -1, { x: p.x, y: p.y - 12 }); return; }
    const foe = this.hostileInSight(s.camp);
    if (foe) {
      const kind = HOSTILE_LINE[foe.kind];
      const mine = kind ? PELL_BARKS.hostile[kind] : null;
      const line = mine && !told(mine.id) ? mine : !told(PELL_BARKS.hostile.any.id) ? PELL_BARKS.hostile.any : null;
      if (line) { this.bark(line, 'point', 2.4, foe.x >= s.camp.x ? 1 : -1, { x: foe.x, y: foe.y - 4 }); return; }
    }
    if (!told(PELL_BARKS.hurt.id) && this.hpFrac() < HURT_BARK) { this.bark(PELL_BARKS.hurt, 'point', 2.2, p.x >= s.camp.x ? 1 : -1, { x: p.x, y: p.y - 12 }); return; }
    if (!told(PELL_BARKS.linger.id) && this.lingerT >= LINGER_S) { this.bark(PELL_BARKS.linger, 'wave', 1.6, p.x >= s.camp.x ? 1 : -1, { x: p.x, y: p.y - 12 }); }
  }

  /** Say it (a caption, once a run) and do something about it. */
  private bark(line: { id: string; text: string }, act: string, seconds: number, face: 1 | -1 | null, look: { x: number; y: number } | null): void {
    const now = this.host.now();
    const ok = this.host.say([{ speaker: 'pell', text: line.text }], { priority: 'low', source: 'pell-bark', ttlMs: 3000, captioned: true, repeatable: true });
    if (!ok) return;
    this.host.setRun(withTold(this.host.run(), barkKey(line.id)));
    this.barkQuietUntil = now + BARK_GAP_S;
    this.lingerT = 0;
    this.react = { act, until: now + seconds, face, look };
    this.actT = 0;
  }

  /** Fire (real burning cells) near the camp. */
  private fireNear(camp: StoryCampSite): boolean {
    const w = this.host.ctx.world;
    if (!w) return false;
    let n = 0;
    for (let y = Math.max(0, camp.floorY - FIRE_REACH); y <= camp.floorY + 6; y++) {
      for (let x = Math.max(0, camp.x - FIRE_REACH); x <= camp.x + FIRE_REACH; x++) {
        if (w.inBounds(x, y) && w.types[w.idx(x, y)] === Cell.Fire && ++n >= FIRE_CELLS) return true;
      }
    }
    return false;
  }

  /** A hostile creature awake within sight of the camp. */
  private hostileInSight(camp: StoryCampSite): { kind: string; x: number; y: number } | null {
    const enemies = this.host.ctx.enemies;
    if (!enemies) return null;
    for (const e of enemies) {
      if (e.hp <= 0 || NO_BARK_KINDS.has(e.kind) || e.boss) continue;
      if (Math.abs(e.x - camp.x) > HOSTILE_X || Math.abs(e.y - camp.floorY) > HOSTILE_Y) continue;
      if (this.host.sees(camp.x, camp.floorY - 12, e.x, e.y - 4)) return { kind: e.kind, x: e.x, y: e.y };
    }
    return null;
  }

  /** The figure to draw (null when he has gone ahead). */
  view(): StoryFigureView | null {
    const s = this.site();
    if (!s?.present) return null;
    return this.figure;
  }

  debug(): Record<string, unknown> {
    return {
      talking: this.talk ? { phase: this.talk.phase, line: this.talk.line, choices: this.talk.choices.map(c => c.label) } : null,
      act: this.figure.act,
      react: this.react?.act ?? null,
      idle: this.idleAct,
      told: [...this.host.run().told],
      pin: this.host.run().pin,
      pinsPaid: [...this.host.run().pinsPaid],
    };
  }
}

/** Pickups already taken within reach of a point: the mark's "has anything been opened here" count. */
function takenNear(rt: LevelRuntime, x: number, y: number): number {
  let n = 0;
  for (const pk of rt.pickups) if (pk.taken && Math.hypot(pk.x - x, pk.y - y) <= PIN_REACH) n++;
  return n;
}

/** A small string hash for seeding a camp's idle life. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Pell's mark: the floor's best sealed secret — an untaken tome, chest or heart
 * inside a rune vault or a sealed pocket, nearest his camp; else any untaken
 * tome or chest.
 */
export function secretMark(rt: LevelRuntime, camp: { x: number; floorY: number } | null): { x: number; y: number } | null {
  const rank: Record<string, number> = { tome: 0, chest: 1, heart: 2, goldpile: 3, potion: 4 };
  const from = camp ?? { x: rt.spawn.x, floorY: rt.spawn.y };
  const candidates: Array<{ x: number; y: number; score: number }> = [];
  for (const v of rt.runeVaults) if (v.active !== false && v.door.length > 0) candidates.push({ x: v.rx, y: v.ry, score: -1 + Math.hypot(v.rx - from.x, v.ry - from.floorY) / 2000 });
  for (const p of rt.pickups) {
    if (p.taken || rank[p.kind] === undefined) continue;
    candidates.push({ x: Math.round(p.x), y: Math.round(p.y), score: rank[p.kind] + Math.hypot(p.x - from.x, p.y - from.floorY) / 2000 });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] ?? null;
}

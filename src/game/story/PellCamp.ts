import type { StoryDialogueView, StoryFigureView, StoryCampSite } from '@/core/story';
import type { CardId, LevelRuntime } from '@/core/types';
import { PELL, PELL_LAST_PAGE, SPEAKER_NAMES, type PellChoice, type PellGift, type PellVisit } from '@/content/story';
import { buildCardOffer, collectOwnedCards, SANCTUM_LOST_PAGES_POOL, TOME_REWARD_POOL, withDiscoveredCards } from '@/combat/wands/rewardPools';
import { getDiscoveredCards } from '@/combat/wands/cardDiscovery';
import { fxRandom } from '@/core/simRandom';
import { beatHeard, pellRecognition } from './storyMeta';
import type { StoryHost } from './host';
import { glowseedCap, GLOWSEED_POUCH_MAX } from '@/game/glowseeds';

/**
 * PELL, at his camp (wave 3 WS-S). A figure on the story rig in a surveyor's
 * long coat, a map case on his back and a lantern on a pole; between visits
 * he sketches his map, warms his hands at the lantern, looks about, and
 * startles at loud noises. He turns to face the apprentice who comes near.
 *
 * Talking (E) opens the dialogue box: his greeting line by line (voiced; the
 * text types on in step), then up to three choices, a reply, his gift, and a
 * farewell. It never pauses the run; Esc, a click away or walking off ends it.
 * On the Kiln his camp is cold: he has gone ahead, and his last map page lies
 * on the bedroll (E reads it, in his voice).
 */

/** Reach for the prompt and for talking (cells from Pell's feet). */
const TALK_REACH = 28;
/** He notices you within this, and turns to look. */
const NOTICE = 110;
/** Walk this far off and the conversation ends. */
const LEAVE = 64;

type Phase = 'idle' | 'greet' | 'choose' | 'reply' | 'farewell';

interface Talk {
  visit: PellVisit;
  phase: Phase;
  /** Lines left to say in this phase, and the one on screen. */
  queue: string[];
  line: string;
  /** Wall time the current line ends (voice or reading pace). */
  lineEnds: number;
  /** Wall time the box finishes typing it (E before then shows it whole instead of moving on). */
  typedBy: number;
  instant: boolean;
  choices: readonly PellChoice[];
  /** The page on the Kiln (a note, not a conversation). */
  page: boolean;
  closeAt: number;
}

export class PellCamp {
  private talk: Talk | null = null;
  private idleAct: 'sketch' | 'warm' | 'stand' | 'lookup' = 'sketch';
  private idleUntil = 0;
  private actT = 0;
  private startleUntil = 0;
  private waved = false;
  private facing: 1 | -1 = 1;
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

  /** A loud noise near the camp: he jumps. */
  noise(x: number, y: number, strength: number): void {
    const s = this.site();
    if (!s?.present || this.talk) return;
    if (Math.hypot(x - s.camp.x, y - s.camp.floorY) > 160 + strength * 120) return;
    this.startleUntil = this.host.now() + 0.9;
    this.actT = 0;
  }

  levelChanged(): void {
    this.close(false);
    this.waved = false;
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
    // A second talk on the same floor, same run: only his farewell (a light touch).
    let visit: PellVisit;
    const meta = this.host.meta();
    if (!beatHeard(meta, pell.first.id)) visit = pell.first;
    else visit = pellRecognition(meta) === 'veteran' && pell.veteran ? pell.veteran : pell.again;
    const choices = here?.gift ? [] : visit.choices;
    const greet = here?.met ? [] : [...visit.greet];
    this.talk = { visit, phase: greet.length ? 'greet' : 'farewell', queue: greet.length ? greet : [visit.farewell], line: '', lineEnds: 0, typedBy: 0, instant: false, choices, page: false, closeAt: 0 };
    if (!here?.met) {
      const firstThisRun = !Object.values(run.pell).some(v => v.met);
      this.host.setRun({ ...run, pell: { ...run.pell, [this.levelKey]: { met: true, gift: here?.gift ?? null } } });
      this.host.updateMeta(m => ({
        ...m,
        pellRuns: firstThisRun ? m.pellRuns + 1 : m.pellRuns,
        heard: m.heard.includes(visit.id) ? m.heard : [...m.heard, visit.id],
      }));
      this.host.unlockJournal(`journal.pell.${s.biome}`);
    }
    this.nextLine();
    return true;
  }

  private readPage(): boolean {
    const run = this.host.run();
    const meta = this.host.meta();
    const page = beatHeard(meta, PELL_LAST_PAGE.first.id) ? PELL_LAST_PAGE.again : PELL_LAST_PAGE.first;
    this.talk = { visit: { id: page.id, greet: [], choices: [], farewell: '' }, phase: 'reply', queue: [...page.lines], line: '', lineEnds: 0, typedBy: 0, instant: false, choices: [], page: true, closeAt: 0 };
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
    t.phase = 'reply';
    t.queue = [...choice.reply];
    if (choice.gift) this.give(choice.gift);
    this.nextLine();
  }

  close(publish = true): void {
    if (!this.talk) return;
    this.talk = null;
    this.host.ctx.narrator?.cutSource?.('pell');
    if (publish) this.publish(null);
  }

  private nextLine(): void {
    const t = this.talk;
    if (!t) return;
    const text = t.queue.shift();
    if (text === undefined) {
      if (t.phase === 'greet') {
        if (t.choices.length) { t.phase = 'choose'; t.line = t.line || ''; this.publish(t); return; }
        t.phase = 'farewell';
        t.queue = t.visit.farewell ? [t.visit.farewell] : [];
        this.nextLine();
        return;
      }
      if (t.phase === 'reply' && !t.page) {
        t.phase = 'farewell';
        t.queue = t.visit.farewell ? [t.visit.farewell] : [];
        this.nextLine();
        return;
      }
      this.close();
      return;
    }
    t.line = text;
    const line = { speaker: 'pell' as const, text };
    const seconds = this.host.lineSeconds(line);
    // His lines are spoken; the box shows the words (no caption of their own).
    this.host.say([line], { priority: 'high', source: 'pell', ttlMs: 4000, captioned: false, repeatable: true });
    t.lineEnds = this.host.now() + seconds + 0.45;
    t.typedBy = this.host.now() + Math.max(0.6, seconds * 0.92);
    t.instant = false;
    this.publish(t);
  }

  private publish(t: Talk | null): void {
    const s = this.site();
    const view: StoryDialogueView = t && s
      ? {
        open: true, speaker: 'pell', name: t.page ? 'Pell’s last page' : SPEAKER_NAMES.pell, text: t.line,
        seconds: Math.max(0.6, t.lineEnds - this.host.now() - 0.45), instant: t.instant || t.phase === 'choose', choices: t.phase === 'choose' ? t.choices.map(c => c.label) : [],
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
        ctx.events.emit('toast', { text: 'Compass: Pell’s mark' });
      } else {
        // Nothing sealed on this floor: the gift becomes a page instead.
        this.give('page');
      }
    }
  }

  /** The tick: idle life, turning to the apprentice, the conversation's pace and its walking-away end. */
  update(dt: number): void {
    const s = this.site();
    const f = this.figure;
    if (!s || !s.present) return;
    const p = this.host.ctx.player;
    const now = this.host.now();
    const near = !p.dead && Math.hypot(p.x - s.camp.x, p.y - s.camp.floorY) < NOTICE;
    this.actT += dt;
    // Conversation: lines advance on their own when said; walking off ends it.
    const t = this.talk;
    if (t) {
      if (p.dead || Math.abs(p.x - s.camp.x) > LEAVE || Math.abs(p.y - s.camp.floorY) > 70) { this.close(); }
      else if (t.phase !== 'choose' && now >= t.lineEnds) this.nextLine();
    }
    // What he is doing.
    let act: string;
    if (now < this.startleUntil) act = 'startle';
    else if (this.talk) act = this.talk.phase === 'choose' ? 'stand' : 'talk';
    else if (near && !this.waved) {
      act = 'wave';
      if (this.actT > 1.4) { this.waved = true; this.actT = 0; }
    } else {
      if (now >= this.idleUntil) {
        const order = ['sketch', 'warm', 'stand', 'sketch', 'lookup'] as const;
        const next = order[(order.indexOf(this.idleAct) + 1) % order.length];
        this.idleAct = next;
        this.idleUntil = now + (next === 'sketch' ? 7 + fxRandom() * 4 : next === 'warm' ? 5 : 3);
        this.actT = 0;
      }
      act = near && this.idleAct === 'lookup' ? 'stand' : this.idleAct;
    }
    if (act !== f.act) this.actT = 0;
    // He faces you when you are near, else his lantern (warming) or his map.
    if (near || this.talk) this.facing = p.x >= s.camp.x ? 1 : -1;
    else if (act === 'warm') this.facing = s.camp.facing;
    else this.facing = s.camp.facing;
    f.x = s.camp.x; f.y = s.camp.floorY; f.facing = this.facing; f.act = act; f.actT = this.actT;
    f.lookX = near || this.talk ? p.x : null; f.lookY = near || this.talk ? p.y - 12 : null;
  }

  /** The figure to draw (null when he has gone ahead). */
  view(): StoryFigureView | null {
    const s = this.site();
    if (!s?.present) return null;
    return this.figure;
  }

  debug(): Record<string, unknown> {
    return { talking: this.talk ? { phase: this.talk.phase, line: this.talk.line, choices: this.talk.choices.map(c => c.label) } : null, act: this.figure.act };
  }
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

import type { EnemyKind } from '@/core/types';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { BOSS_PROLOGUES } from '@/content/story';
import { beatLine } from './storyMeta';
import type { StoryHost } from './host';

/**
 * BOSS PROLOGUES (Nine Sols weight, not length). As the apprentice comes
 * within sight of a boss's arena — before the boss notices him — the camera
 * glides over to take the arena in while the Docent says one line, then comes
 * back. The boss's own entrance (its roar and its name card, entities/Enemies)
 * follows when he steps into the lair. ≤ 6 s; the player never loses control
 * (he can walk on through it); any movement or a shot hands the camera back
 * at once. Once per run per boss; a heard prologue says its short `again`.
 */

/** How long the camera holds the arena (s) and the ceiling on the whole beat. */
const HOLD = 2.8;
const MAX = 6;
/** Approach window around the arena (cells from the boss's home). */
const NEAR_X = 150;
const NEAR_UP = 150;
const NEAR_DOWN = 60;

/**
 * THE GUARDIAN'S FAR BREATH (levels review #15). A boss floor's guardian was
 * silent and unseen until the player walked into its arena, so nothing said "there
 * is something down there". While it sleeps it breathes where it can be heard: its
 * own idle voice, placed at its arena and left to the mix to fade, now and then, and
 * a puff in its own element (steam off the Kiln, frost off the Cold Store, bubbles
 * off the sump, a prism glint off the Galleries) when its arena is on screen. Inside
 * BREATH_HEARD the floor counts the guardian as heard, and the map marks its arena
 * faintly (ui/Minimap). Awake, it has its own voice and this stops.
 */
const BREATH_RANGE = 640;
const BREATH_HEARD = 420;
/** Seconds between breaths (plus up to BREATH_JITTER). */
const BREATH_EVERY = 7;
const BREATH_JITTER = 3.5;
/** The camera box (HabitatAudio.creatureLife) inside which the guardian's idle already plays. */
const NEAR_CAM_X = 360;
const NEAR_CAM_Y = 240;

const BREATH_PUFF: Partial<Record<EnemyKind, { colors: readonly number[]; kind: 'smoke' | 'magic'; count: number; speed: number; glow?: number }>> = {
  colossus: { colors: [0xc8ccd4, 0xaab0ba, 0xe6e6ea], kind: 'smoke', count: 32, speed: 0.6 },
  rimewarden: { colors: [0xbfe6f4, 0x8fd0ea, 0xe8f8ff], kind: 'smoke', count: 24, speed: 0.45 },
  leviathan: { colors: [0x9fc8e8, 0xd8ecff], kind: 'smoke', count: 16, speed: 0.4 },
  lenswright: { colors: [0xe6dcff, 0xbfe8ff, 0xffffff], kind: 'magic', count: 6, speed: 0.3, glow: 1.1 },
};

interface Beat {
  kind: EnemyKind;
  start: number;
  target: { x: number; y: number };
  released: boolean;
}

export class BossPrologue {
  private beat: Beat | null = null;
  /** Input seen at the start (a key already held does not count as a skip). */
  private armedAt = 0;
  /** host.now() after which the sleeping guardian breathes again. */
  private nextBreath = 0;

  constructor(private readonly host: StoryHost) {}

  get active(): boolean { return this.beat !== null && !this.beat.released; }

  levelChanged(): void { this.release(); this.beat = null; }

  /** Any movement or a shot: the camera comes back now. */
  skip(): void {
    if (this.beat && !this.beat.released && this.host.now() - this.armedAt > 0.35) this.release();
  }

  private release(): void {
    const b = this.beat;
    if (!b || b.released) return;
    b.released = true;
    this.host.ctx.events.emit('storyLetterbox', { on: false });
    const cam = this.host.ctx.camera;
    if (cam.actionFocus && Math.hypot(cam.actionFocus.x - b.target.x, cam.actionFocus.y - b.target.y) < 1) cam.actionFocus = null;
  }

  /** The sleeping guardian's far breath (see BREATH_RANGE); also notes that the floor's guardian has been heard. */
  private farBreath(): void {
    const ctx = this.host.ctx;
    const rt = ctx.levels.current;
    const home = rt?.boss;
    const kind = home?.kind;
    if (!rt || !home || !kind || ctx.player.dead || ctx.state.mode !== 'play') return;
    const boss = ctx.enemies.find(e => e.kind === kind && e.hp > 0);
    if (!boss || boss.boss?.engaged || boss.alerted) return;
    const d = Math.hypot(ctx.player.x - home.x, ctx.player.y - home.y);
    if (d > BREATH_RANGE) return;
    if (d < BREATH_HEARD) rt.bossHeard = true;
    const now = this.host.now();
    if (now < this.nextBreath) return;
    this.nextBreath = now + BREATH_EVERY + Math.random() * BREATH_JITTER;
    const cam = ctx.camera;
    const nearCam = Math.abs(home.x - (cam.x + VIEW_W / 2)) < NEAR_CAM_X && Math.abs(home.y - (cam.y + VIEW_H / 2)) < NEAR_CAM_Y;
    // On screen the boss already mutters (HabitatAudio); beyond that this is its breath.
    if (!nearCam) ctx.audio.at(home.x, home.y - 8, () => ctx.audio.creature(kind, 'idle'), BREATH_RANGE);
    const puff = BREATH_PUFF[kind];
    const seen = Math.abs(home.x - (cam.x + VIEW_W / 2)) < VIEW_W / 2 + 40 && Math.abs(home.y - 20 - (cam.y + VIEW_H / 2)) < VIEW_H / 2 + 40;
    if (puff && seen) {
      ctx.sparks?.burst(home.x, home.y - (kind === 'colossus' ? 30 : 16), {
        count: puff.count, speed: puff.speed, spread: 0.6, angle: -Math.PI / 2, life: 150, colors: puff.colors, kind: puff.kind, glow: puff.glow, radius: 6,
      });
    }
  }

  update(): void {
    this.farBreath();
    const ctx = this.host.ctx;
    const b = this.beat;
    if (b) {
      const t = this.host.now() - b.start;
      // The boss woke (its entrance takes the camera), the player died, or time is up.
      const boss = ctx.enemies.find(e => e.kind === b.kind && e.hp > 0);
      if (!b.released && (t >= Math.min(HOLD, MAX) || !boss || boss.boss?.engaged || ctx.player.dead)) this.release();
      if (b.released && t > MAX) this.beat = null;
      return;
    }
    const rt = ctx.levels.current;
    const home = rt?.boss;
    const kind = home?.kind;
    if (!rt || !home || !kind || ctx.player.dead || ctx.state.mode !== 'play') return;
    const run = this.host.run();
    if (run.prologues.includes(kind)) return;
    const script = BOSS_PROLOGUES[kind];
    if (!script) return;
    const boss = ctx.enemies.find(e => e.kind === kind && e.hp > 0);
    if (!boss || boss.boss?.engaged || boss.alerted) return;
    const p = ctx.player;
    const dx = p.x - home.x, dy = p.y - home.y;
    if (Math.abs(dx) > NEAR_X || dy < -NEAR_UP || dy > NEAR_DOWN) return;
    // Begin: the line, and the camera over the arena.
    this.host.setRun({ ...run, prologues: [...run.prologues, kind] });
    const line = beatLine(this.host.meta(), script);
    if (line) this.host.say([{ speaker: 'docent', text: line.text }], { priority: 'high', source: 'prologue', ttlMs: 3000, captioned: true, repeatable: true, beats: [script.id] });
    const target = { x: home.x, y: home.y - (kind === 'colossus' ? 36 : 22) };
    if (!ctx.state.reduceCameraShake) ctx.camera.actionFocus = { x: target.x, y: target.y, zoom: 1.04 };
    this.beat = { kind, start: this.host.now(), target, released: ctx.state.reduceCameraShake === true };
    this.armedAt = this.host.now();
    if (!this.beat.released) ctx.events.emit('storyLetterbox', { on: true });
  }

  debug(): Record<string, unknown> {
    return this.beat ? { kind: this.beat.kind, t: +(this.host.now() - this.beat.start).toFixed(2), released: this.beat.released } : { kind: null };
  }
}

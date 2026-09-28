import type { EnemyKind } from '@/core/types';
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

  update(): void {
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

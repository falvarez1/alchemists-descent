import type { StoryFigureView, StoryValveSite } from '@/core/story';
import { ECHOES, type EchoActor, type EchoScript } from '@/content/story';
import type { StoryHost } from './host';
import { fxRandom } from '@/core/simRandom';

/**
 * MEMORY ECHOES (wave 3 WS-S). The floor's resonant valve: turn it (E) and the
 * Works play back what they remember of this place — translucent Guild
 * silhouettes on the story rig, walking the keyframes of the floor's echo
 * (content/story/echoes) while the Docent narrates. The player keeps control;
 * walking away ends it (the ghosts fade, the narration is cut). The echo is
 * written into the Journal as it begins, and can be turned again.
 */

/** Reach for the valve (cells from the wheel). */
const TURN_REACH = 26;
/** Fade in / out (s). */
const FADE_IN = 1.1;
const FADE_OUT = 1.3;
/** Walk this far from the stage and the memory lets go. */
const LEAVE_MARGIN = 70;
/** Actors fade out over this many cells past the stage's half-width. */
const EDGE_FADE = 12;

/** Where an actor is, and what it is doing, at echo time `t`. Pure (tests/story.test.ts). */
export function actorAt(actor: EchoActor, t: number): { dx: number; dy: number; act: string; face: 1 | -1; actStart: number; moving: boolean } {
  const keys = actor.keys;
  if (keys.length === 0) return { dx: 0, dy: 0, act: 'stand', face: 1, actStart: 0, moving: false };
  if (t <= keys[0].t) return { dx: keys[0].dx, dy: keys[0].dy ?? 0, act: keys[0].act, face: keys[0].face, actStart: 0, moving: false };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= b.t) continue;
    const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
    const ddx = b.dx - a.dx, ddy = (b.dy ?? 0) - (a.dy ?? 0);
    const moving = Math.abs(ddx) > 0.5 || Math.abs(ddy) > 0.5;
    if (!moving) return { dx: a.dx, dy: a.dy ?? 0, act: a.act, face: a.face, actStart: a.t, moving: false };
    const act = b.act === 'run' || b.act === 'carry' || b.act === 'climb' ? b.act : 'walk';
    const face: 1 | -1 = Math.abs(ddx) > 0.5 ? (ddx > 0 ? 1 : -1) : b.face;
    return { dx: a.dx + ddx * u, dy: (a.dy ?? 0) + ddy * u, act, face, actStart: a.t, moving: true };
  }
  const last = keys[keys.length - 1];
  return { dx: last.dx, dy: last.dy ?? 0, act: last.act, face: last.face, actStart: last.t, moving: false };
}

interface Playing {
  script: EchoScript;
  start: number;
  /** When the narration should be done (estimated from the lines' lengths). */
  talkEnds: number;
  fadeFrom: number | null;
  figures: StoryFigureView[];
  lastT: number;
}

export class EchoStage {
  private playing: Playing | null = null;
  private turn = 0;
  private hum = 0;

  constructor(private readonly host: StoryHost) {}

  private site(): { valve: StoryValveSite; script: EchoScript } | null {
    const valve = this.host.ctx.levels.current?.story?.valve;
    const biome = this.host.biome();
    const script = biome ? ECHOES[biome] : undefined;
    if (!valve || !script || this.host.floor() <= 0) return null;
    return { valve, script };
  }

  get active(): boolean { return this.playing !== null; }

  inReach(): boolean {
    const s = this.site();
    const p = this.host.ctx.player;
    return !!s && !p.dead && Math.abs(p.x - s.valve.x) <= TURN_REACH && p.y > s.valve.floorY - 40 && p.y < s.valve.floorY + 12;
  }

  prompt(): { x: number; y: number; verb: string } | null {
    if (this.playing || !this.inReach()) return null;
    const s = this.site()!;
    return { x: s.valve.x, y: s.valve.floorY - 26, verb: 'Turn the valve' };
  }

  interact(): boolean {
    if (this.playing || !this.inReach()) return false;
    const s = this.site()!;
    this.begin(s.script, s.valve);
    return true;
  }

  private begin(script: EchoScript, valve: StoryValveSite): void {
    const now = this.host.now();
    const lines = script.lines.map(text => ({ speaker: 'docent' as const, text }));
    // The memory takes a breath to surface before the Docent speaks over it.
    const talk = lines.reduce((sum, l) => sum + this.host.lineSeconds(l) + 0.3, 0);
    this.playing = { script, start: now, talkEnds: now + 0.8 + talk, fadeFrom: null, figures: [], lastT: 0 };
    this.host.ctx.audio.sfx('mech.grip', valve.x, valve.floorY - 16);
    this.host.ctx.audio.sfx('mech.shrine', valve.x, valve.floorY - 16);
    const run = this.host.run();
    if (!run.echoes.includes(script.id)) this.host.setRun({ ...run, echoes: [...run.echoes, script.id] });
    this.host.unlockJournal(`journal.${script.id}`);
    this.host.updateMeta(m => (m.heard.includes(script.id) ? m : { ...m, heard: [...m.heard, script.id] }));
    window.setTimeout(() => {
      if (this.playing?.script !== script || this.playing.fadeFrom !== null) return;
      this.host.say(lines, { priority: 'high', source: 'echo', ttlMs: 8000, captioned: true, repeatable: true });
    }, 800);
  }

  /** Let the memory go (walked away, a new floor, a death). */
  end(): void {
    const p = this.playing;
    if (!p || p.fadeFrom !== null) return;
    p.fadeFrom = this.host.now();
    this.host.ctx.narrator?.cutSource?.('echo');
  }

  levelChanged(): void {
    this.playing = null;
    this.turn = 0;
    this.hum = 0;
  }

  update(dt: number): void {
    const s = this.site();
    const p = this.playing;
    this.turn = Math.max(0, this.turn - dt * 0.4);
    this.hum += ((p && p.fadeFrom === null ? 1 : 0) - this.hum) * Math.min(1, dt * 2.5);
    if (!p || !s) { if (p && !s) this.playing = null; return; }
    const now = this.host.now();
    const t = now - p.start;
    if (t < 1.2) this.turn = Math.min(1, t / 1.2);
    const player = this.host.ctx.player;
    if (p.fadeFrom === null) {
      const away = player.dead || Math.abs(player.x - s.valve.stageX) > s.valve.stageHalfW + LEAVE_MARGIN || Math.abs(player.y - s.valve.floorY) > 90;
      if (away || t >= Math.max(p.script.seconds, p.talkEnds - p.start) + 0.6) this.end();
    }
    let alpha = Math.min(1, t / FADE_IN);
    if (p.fadeFrom !== null) {
      alpha *= Math.max(0, 1 - (now - p.fadeFrom) / FADE_OUT);
      if (alpha <= 0) { this.playing = null; return; }
    }
    const endT = p.script.seconds;
    p.figures = p.script.actors.map((actor, i) => {
      const at = actorAt(actor, Math.min(t, endT + (actor.lingers ? 30 : 0)));
      const edge = Math.max(0, Math.abs(at.dx) - s.valve.stageHalfW);
      const a = alpha * Math.max(0, 1 - edge / EDGE_FADE) * (t > endT && !actor.lingers ? Math.max(0, 1 - (t - endT) / 1.5) : 1);
      const prev = p.figures[i];
      const stride = (prev?.stride ?? 0) + (at.moving ? dt * (at.act === 'run' ? 11 : 6.5) : 0);
      return {
        x: s.valve.stageX + at.dx, y: s.valve.floorY - at.dy, facing: at.face, costume: actor.costume, act: at.act,
        actT: Math.max(0, t - at.actStart), stride, alpha: a, ghost: true, lookX: null, lookY: null, seed: i * 17 + 3,
      };
    });
    p.lastT = t;
    // Memory sheds a little light: pale motes lift off the silhouettes.
    const ctx = this.host.ctx;
    if ((ctx.state.frameCount % 5) === 0 && !ctx.state.reduceFlashes) {
      for (const f of p.figures) {
        if (f.alpha < 0.3) continue;
        ctx.particles.spawn(f.x + (fxRandom() - 0.5) * 7, f.y - 3 - fxRandom() * 13, (fxRandom() - 0.5) * 0.08, -0.12 - fxRandom() * 0.12,
          null, 0x9af0dc, 70, { glow: 1.6 * f.alpha, grav: -0.002 });
      }
    }
  }

  view(): { alpha: number; actors: StoryFigureView[] } | null {
    const p = this.playing;
    if (!p) return null;
    return { alpha: 1, actors: p.figures };
  }

  valveView(): { turn: number; hum: number; used: boolean } {
    const s = this.site();
    const used = !!s && this.host.run().echoes.includes(s.script.id);
    return { turn: this.turn, hum: this.hum, used };
  }

  debug(): Record<string, unknown> {
    const p = this.playing;
    return p ? { id: p.script.id, t: this.host.now() - p.start, fading: p.fadeFrom !== null, actors: p.figures.map(f => ({ x: Math.round(f.x), act: f.act, a: +f.alpha.toFixed(2) })) } : { id: null };
  }
}

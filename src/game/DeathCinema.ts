import type { Ctx } from '@/core/types';
import { packRGB } from '@/sim/colors';
import { fxRandom } from '@/core/simRandom';

/**
 * The death, directed. Runs on wall-clock time (slow motion must not stall it)
 * from the moment the alchemist falls until he returns:
 *
 *   0.0s  the blow: hitstop, bloom, the ragdoll launches (Player.kill)
 *   0.15s the camera starts its push-in on the body; the world drains of colour
 *   0.35s, 1.15s, 2.2s  three heartbeats, each slower and fainter
 *   0.5s  letterbox bars slide in
 *   ~1.4s the wand's light gutters out; once the body rests, pale motes rise
 *   2.6s  (and the body at rest) the title card
 *
 * Game-side only: the DOM hears it through 'deathCinema' events.
 */
const BEATS = [0.35, 1.15, 2.2];
export const DEATH_TITLE_AT = 2.6;

export class DeathCinema {
  private t = 0;
  private beat = 0;
  private letterboxed = false;
  private titled = false;
  private settled = false;
  private moteT = 0;

  private readonly offs: Array<() => void> = [];

  constructor(private readonly ctx: Ctx) {
    this.offs.push(
      ctx.events.on('playerDied', () => this.begin()),
      ctx.events.on('playerCorpseSettled', () => { this.settled = true; }),
      ctx.events.on('playerRespawned', () => this.end()),
      ctx.events.on('playerDeathCleared', () => this.end()),
    );
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
  }

  private begin(): void {
    this.t = 0; this.beat = 0; this.letterboxed = false; this.titled = false; this.settled = false; this.moteT = 0;
    this.ctx.fx.deathTime = 0.0001;
    this.ctx.fx.bloomKick = Math.max(this.ctx.fx.bloomKick, 1.4);
  }

  private end(): void {
    this.ctx.fx.deathTime = 0;
    if (this.letterboxed || this.titled) this.ctx.events.emit('deathCinema', { phase: 'end' });
    this.letterboxed = false; this.titled = false;
  }

  /** Advance on real time (seconds since the last rendered frame). */
  update(dt: number): void {
    const ctx = this.ctx;
    // An arena knockout (a Duel ring-out, a bout's loss) belongs to the arena: its announcer and results, never the
    // descent's heartbeats, letterbox, drained colour or death card (Player.kill makes the same call).
    if (!ctx.player.dead || ctx.state.mode !== 'play' || ctx.arena?.active) { if ((ctx.fx.deathTime ?? 0) > 0) this.end(); return; }
    // A fall in the Kiln escape is not a death scene: the story fades and restarts the climb.
    if (ctx.story?.escapeActive) { if ((ctx.fx.deathTime ?? 0) > 0) this.end(); return; }
    if (ctx.state.paused) return;
    this.t += Math.min(0.1, dt);
    ctx.fx.deathTime = this.t;
    while (this.beat < BEATS.length && this.t >= BEATS[this.beat]) {
      const k = 1 - this.beat * 0.28;
      ctx.audio.sfx('player.heartbeat', undefined, undefined, { gain: k });
      this.beat++;
    }
    if (!this.letterboxed && this.t >= 0.5) { this.letterboxed = true; ctx.events.emit('deathCinema', { phase: 'begin' }); }
    // The light leaves him: once he rests, a few pale motes lift off the body.
    const torso = ctx.rigidBodies?.playerCorpse;
    if (torso && this.settled && this.moteT < 34 && this.t > 1.2) {
      this.moteT++;
      if (this.moteT % 4 === 0) {
        ctx.particles.spawn(torso.x + (fxRandom() - 0.5) * 6, torso.y - 2, (fxRandom() - 0.5) * 0.12, -0.22 - fxRandom() * 0.18,
          null, packRGB(190, 236, 244), 110, { glow: 2.2, grav: -0.004 });
      }
    }
    if (!this.titled && this.t >= DEATH_TITLE_AT && (this.settled || this.t > 5)) {
      this.titled = true;
      ctx.audio.sfx('ui.curtain');
      ctx.events.emit('deathCinema', { phase: 'title' });
    }
  }
}

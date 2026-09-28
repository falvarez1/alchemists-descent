import type { KilnFlueSite } from '@/core/story';
import { ESCAPE_LINES, ESCAPE_OBJECTIVE } from '@/content/story';
import { blocksEntity, Cell } from '@/sim/CellType';
import { lavaColor, packRGB, steamColor } from '@/sim/colors';
import { fxRandom } from '@/core/simRandom';
import { inFlue, openKilnFlue, resetKilnFlue } from '@/world/kilnFlue';
import { beatLine } from './storyMeta';
import type { StoryHost } from './host';

/**
 * THE KILN ESCAPE (Ori's escapes; wave 3 WS-S). When the Colossus falls the
 * Heart gives its last great heave:
 *
 *  - the metal damper between the Kiln and its old flue is blown out, the
 *    Kiln's ceiling comes down in chunks (real stone turned to falling sand),
 *    and the flue's side openings fuse shut in the heat (a skin of real stone
 *    over every opening, so what rises stays in the climb);
 *  - after a breath, REAL LAVA rises: row by row through the Kiln, the damper's
 *    passage and up the shaft, turning water it meets to steam and throwing
 *    steam up ahead of it; it keeps pace with a quick climber and never
 *    outruns a steady one;
 *  - cracked masonry in the shaft walls crumbles as the lava climbs past below;
 *  - the brass hatch over the top ledge is the way out: reaching it ends the
 *    escape, and the ending (and then the Ledger) follows.
 *
 * The climb is meant to matter (QA levitated a fresh profile to the hatch in
 * 5.6 s): the Heart's HEAT THINS THE LEVITATION — in the shaft the jet burns
 * HEAT_LEV_DRAIN more LEV a tick, so it is ledge to ledge, not one long rise
 * — and STEAM GUSTS exhale up the shaft's clear middle every GUST_EVERY s
 * (a hiss and a boil at the lava first): a body caught mid-air in one is
 * knocked down and its jet snuffed, one on a ledge is spared. The lava keeps
 * a pace a clean ledge-to-ledge climb (~30-45 s) stays ahead of.
 *
 * Fail-open generosity: a death in the climb costs no phial, spills no gold
 * and shows no death screen (entities/Player, game/DeathCinema, ui/Hud) — a
 * quick fade (`storyFade`), the shaft is set back exactly as generated
 * (world/kilnFlue.resetKilnFlue), the lava drains, and the apprentice starts
 * again at the foot of the flue. A run saved mid-escape resumes there.
 */

/** Seconds between the heave and the first row of lava; after a restart, a shorter breath. */
const GRACE = 3.2;
const RESTART_GRACE = 2.4;
/**
 * Rows per tick the lava climbs: steady, catching up on a long lead, easing off
 * close under the boots. (2026-09: 0.09 / 0.24 / 0.06, was 0.11 / 0.3 / 0.085 —
 * paced to the ledge-to-ledge climb the heat and the gusts now make.)
 */
const RISE = 0.09;
const RISE_FAST = 0.24;
const RISE_SLOW = 0.06;
/** A death in the climb: the screen fades after this (s), and the flue is set back at RESTART_AFTER. */
const DEATH_FADE_AT = 0.45;
const RESTART_AFTER = 1.15;
/**
 * THE HEAT THINS THE LEVITATION: in the shaft the jet burns HEAT_LEV_DRAIN more
 * LEV a tick (on top of its own 1.15: ~0.6 s of lift from full), and standing
 * on a ledge the heat takes back HEAT_REGEN_CUT of the ground's 1.7 a tick
 * (a full refill takes ~3 s): a hop, a breath on the ledge, the next hop.
 */
const HEAT_LEV_DRAIN = 2.0;
const HEAT_REGEN_CUT = 1.45;
/** STEAM GUSTS: one every GUST_EVERY s, told GUST_TELL s ahead (a hiss, the lava boiling), rising GUST_SPEED rows a tick. */
const GUST_EVERY = 3.4;
const GUST_TELL = 0.75;
const GUST_SPEED = 3.4;
/** Half-width of the gust's column: the shaft's clear middle (the ledges either side are out of it). */
const GUST_HALF_W = 7;

const FUSED = (x: number, y: number): number => ((x * 13 + y * 7) % 17 === 0 ? packRGB(120, 48, 20) : packRGB(44 + ((x + y) % 5), 30, 28));
const RUBBLE = (x: number, y: number): number => packRGB(96 + ((x * 5 + y * 3) % 9) * 3, 86, 74);

type Phase = 'none' | 'heave' | 'climb' | 'done';

export class KilnEscape {
  private phase: Phase = 'none';
  private flue: KilnFlueSite | null = null;
  /** The lava's surface row (rows below it, inside the escape's cells, are lava). */
  private lavaRow = 0;
  private filledTo = 0;
  private riseAt = 0;
  private heaveAt = 0;
  private deathAt: number | null = null;
  private slabsDone = new Set<number>();
  private saidClimb = false;
  private saidTop = false;
  private pendingResume = false;
  private onComplete: (() => void) | null = null;
  /** The camera leans up the shaft during the climb (cells). */
  private look = 0;
  /** The next steam gust (s), its front row while it rises, whether it was told, whether it caught him. */
  private gustAt = 0;
  private gustRow: number | null = null;
  private gustTold = false;
  private gustHit = false;
  /** The death fade is down (storyFade). */
  private fading = false;

  constructor(private readonly host: StoryHost) {}

  get active(): boolean { return this.phase === 'heave' || this.phase === 'climb'; }
  get site(): KilnFlueSite | null { return this.flue; }
  get lava(): number { return this.lavaRow; }
  get heat(): number { return this.active ? 1 : 0; }

  /** The Colossus is down. Returns false (the run ends as before) when this floor has no flue. */
  begin(onComplete: () => void): boolean {
    const ctx = this.host.ctx;
    const flue = ctx.levels.current?.story?.flue;
    if (!flue || this.phase !== 'none' || ctx.state.mode !== 'play') return false;
    this.flue = flue;
    this.onComplete = onComplete;
    this.phase = 'heave';
    this.heaveAt = this.host.now();
    this.riseAt = this.heaveAt + GRACE;
    this.lavaRow = flue.lavaFrom + 1;
    this.filledTo = flue.lavaFrom + 1;
    this.slabsDone.clear();
    this.saidClimb = false;
    this.saidTop = false;
    this.heave(flue);
    const run = this.host.run();
    this.host.setRun({ ...run, escape: 'active' });
    const line = beatLine(this.host.meta(), ESCAPE_LINES.heave);
    if (line) this.host.say([{ speaker: 'docent', text: line.text }], { priority: 'high', source: 'escape', ttlMs: 3000, captioned: true, repeatable: true, beats: [ESCAPE_LINES.heave.id] });
    ctx.events.emit('objectiveChanged', { text: ESCAPE_OBJECTIVE });
    const rt = ctx.levels.current;
    if (rt) rt.mapWaypoint = { x: flue.exit.x, y: flue.exit.y, label: 'The Hatch' };
    return true;
  }

  /** A run saved mid-escape comes back: the climb restarts at the flue's foot. */
  resume(onComplete: () => void): void {
    const flue = this.host.ctx.levels.current?.story?.flue;
    if (!flue) return;
    this.flue = flue;
    this.onComplete = onComplete;
    this.phase = 'heave';
    this.pendingResume = true;
    this.slabsDone.clear();
  }

  /** Levels asks where a death returns to: the flue's foot while the escape runs. */
  respawnPoint(): { x: number; y: number } | null {
    return this.active && this.flue ? { x: this.flue.start.x, y: this.flue.start.y } : null;
  }

  levelChanged(): void {
    // Leaving the Kiln mid-escape is not possible (no portal); a level change means a new run.
    if (this.host.levelId() !== 'd4' && !this.host.ctx.levels.current?.story?.flue) { this.phase = 'none'; this.flue = null; }
  }

  reset(): void {
    this.phase = 'none';
    this.flue = null;
    this.onComplete = null;
    this.pendingResume = false;
    this.deathAt = null;
  }

  /* ---------------- the heave ---------------- */

  private heave(flue: KilnFlueSite): void {
    const ctx = this.host.ctx;
    const w = ctx.world;
    // The damper goes: a burst of steam and iron.
    const opened = openKilnFlue(w, flue);
    const dx = (flue.damper.x0 + flue.damper.x1) / 2, dy = (flue.damper.y0 + flue.damper.y1) / 2;
    ctx.particles.burst(dx, dy, 34, null, () => packRGB(190, 190, 184), 3.2, { grav: -0.02 });
    ctx.particles.burst(dx, dy, 18, null, () => packRGB(255, 140, 40), 2.6, { glow: 2.2, grav: 0.04 });
    if (opened > 0) ctx.audio.sfx('mech.door', dx, dy);
    ctx.audio.boom(18, dx, dy);
    ctx.audio.groan(dx, dy);
    ctx.fx.screenShake = Math.max(ctx.fx.screenShake, ctx.state.reduceCameraShake ? 0.02 : 0.07);
    if (!ctx.state.reduceFlashes) ctx.fx.bloomKick = Math.max(ctx.fx.bloomKick, 1.2);
    this.fuse(flue);
    this.collapseKilnCeiling(flue);
  }

  /** The escape's cells: the Kiln, the damper's doorway, the passage and the shaft. */
  private inEscape(f: KilnFlueSite, x: number, y: number): boolean {
    const a = f.arena;
    return (x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1) || inFlue(f, x, y);
  }

  /**
   * The heat fuses the chimney shut around the climb: a two-cell skin of stone
   * over every opening in the shaft's walls and the passage's roof (the climb
   * becomes a chimney again, and what rises stays in it), and the Kiln's far
   * door, where the lava would otherwise run out into the caves.
   */
  private fuse(f: KilnFlueSite): void {
    const w = this.host.ctx.world;
    const seal = (x: number, y: number): void => {
      if (!w.inBounds(x, y) || this.inEscape(f, x, y)) return;
      const i = w.idx(x, y);
      const t = w.types[i];
      if (t === Cell.Metal || blocksEntity(t)) return;
      w.replaceCellAt(i, Cell.Stone, FUSED(x, y));
    };
    for (let y = f.shaft.y0; y <= f.shaft.y1; y++) for (let d = 1; d <= 2; d++) { seal(f.shaft.x0 - d, y); seal(f.shaft.x1 + d, y); }
    for (const r of [f.passage, f.damper]) for (let x = r.x0; x <= r.x1; x++) for (let d = 1; d <= 2; d++) seal(x, r.y0 - d);
    const cx = Math.round((f.arena.x0 + f.arena.x1) / 2), far = -f.side;
    for (let y = f.arena.y1 - 34; y <= f.arena.y1; y++) for (let d = 0; d <= 1; d++) seal(cx + far * (62 + d), y);
  }

  /** The Kiln's ceiling comes down in chunks: real stone above the vault turned to falling rubble. */
  private collapseKilnCeiling(f: KilnFlueSite): void {
    const ctx = this.host.ctx;
    const w = ctx.world;
    const cx = Math.round((f.arena.x0 + f.arena.x1) / 2);
    for (const off of [-50, -18, 18, 50]) {
      const x = cx + off;
      let ceil = -1;
      for (let y = f.arena.y1 - 20; y > f.arena.y0 - 8; y--) {
        if (!w.inBounds(x, y)) break;
        if (blocksEntity(w.types[w.idx(x, y)])) { ceil = y; break; }
      }
      if (ceil < 0) continue;
      for (let yy = ceil - 6; yy <= ceil; yy++) for (let xx = x - 5; xx <= x + 5; xx++) {
        if (!w.inBounds(xx, yy) || (xx - x) * (xx - x) + (yy - ceil + 3) * (yy - ceil + 3) > 26) continue;
        const i = w.idx(xx, yy);
        if (w.types[i] === Cell.Stone || w.types[i] === Cell.Wall) w.replaceCellAt(i, Cell.Sand, RUBBLE(xx, yy));
      }
      ctx.particles.burst(x, ceil + 2, 10, null, () => packRGB(150, 138, 120), 1.6, { grav: 0.06 });
    }
    ctx.audio.sfx('creature.colossus.death.rubble', cx, f.arena.y0 + 10);
  }

  /* ---------------- the climb ---------------- */

  update(dt: number): void {
    const flue = this.flue;
    // The camera looks up the shaft while you climb, and settles back after.
    const want = this.active && !this.host.ctx.player.dead ? -46 : 0;
    if (want !== 0 || this.look !== 0) {
      this.look += (want - this.look) * Math.min(1, dt * 2.2);
      if (Math.abs(this.look) < 0.3 && want === 0) this.look = 0;
      this.host.ctx.camera.cineDy = this.look;
    }
    if (!flue || !this.active) return;
    const ctx = this.host.ctx;
    const now = this.host.now();
    const p = ctx.player;
    if (this.pendingResume && !ctx.levels.transitioning) {
      this.pendingResume = false;
      this.restart(true);
      return;
    }
    // A death in the climb: a quick fade, the flue set back, and he is at its foot again.
    if (p.dead) {
      this.deathAt ??= now;
      if (!this.fading && now - this.deathAt >= DEATH_FADE_AT) {
        this.fading = true;
        ctx.events.emit('storyFade', { on: true });
      }
      if (now - this.deathAt >= RESTART_AFTER) this.restart(false);
      return;
    }
    this.deathAt = null;
    if (this.phase === 'heave' && now >= this.riseAt) {
      this.phase = 'climb';
      this.gustAt = now + GUST_EVERY * 0.6;
    }
    // The Heart's heat thins the levitation in the shaft: ledge to ledge.
    const inShaft = p.x >= flue.shaft.x0 - 2 && p.x <= flue.shaft.x1 + 2 && p.y <= flue.shaft.y1 + 2 && p.y >= flue.shaft.y0;
    if (inShaft && (p.grounded || p.inLiquid) && p.levit < p.maxLevit) p.levit = Math.max(0, p.levit - HEAT_REGEN_CUT);
    if (inShaft && p.levitating && p.levit > 0) {
      p.levit = Math.max(0, p.levit - HEAT_LEV_DRAIN);
      if ((ctx.state.frameCount & 3) === 0) {
        ctx.particles.spawn(p.x + (fxRandom() - 0.5) * 6, p.y + 1, (fxRandom() - 0.5) * 0.3, 0.4 + fxRandom() * 0.4, null, packRGB(255, 150 + Math.floor(fxRandom() * 60), 70), 14, { glow: 1.4, grav: 0.02 });
      }
    }
    // The way out.
    if (p.x >= flue.shaft.x0 - 2 && p.x <= flue.shaft.x1 + 2 && p.y <= flue.exit.y + 2 && p.y >= flue.shaft.y0) {
      this.complete();
      return;
    }
    if (this.phase === 'climb') {
      const gap = this.lavaRow - p.y;
      const rise = gap > 110 ? RISE_FAST : gap < 34 ? RISE_SLOW : RISE;
      this.lavaRow = Math.max(flue.shaft.y0 + 8, this.lavaRow - rise * (dt * 60));
      this.fill(flue);
      this.crumble(flue);
      this.gust(flue, now, dt);
    }
    // Steam and embers off the surface: the heat you are running from.
    if ((ctx.state.frameCount & 3) === 0) this.breathe(flue);
    // A word halfway up, and near the top.
    const height = flue.lavaFrom - p.y;
    const total = flue.lavaFrom - flue.exit.y;
    if (!this.saidClimb && height > total * 0.34) {
      this.saidClimb = true;
      const line = beatLine(this.host.meta(), ESCAPE_LINES.climb);
      if (line) this.host.say([{ speaker: 'docent', text: line.text }], { priority: 'normal', source: 'escape', ttlMs: 6000, captioned: true, repeatable: true, beats: [ESCAPE_LINES.climb.id] });
    }
    if (!this.saidTop && height > total * 0.66) {
      this.saidTop = true;
      const line = beatLine(this.host.meta(), ESCAPE_LINES.top);
      if (line) this.host.say([{ speaker: 'docent', text: line.text }], { priority: 'normal', source: 'escape', ttlMs: 6000, captioned: true, repeatable: true, beats: [ESCAPE_LINES.top.id] });
    }
  }

  /** Lava into every open cell of the escape at or below the surface (water it meets flashes to steam). */
  private fill(f: KilnFlueSite): void {
    const w = this.host.ctx.world;
    const top = Math.ceil(this.lavaRow);
    // New rows, plus a few below the surface (what the sim moved or cooled back open).
    const from = Math.min(this.filledTo, top), to = Math.min(f.lavaFrom, Math.max(top + 3, this.filledTo + 3));
    for (let y = from; y <= to; y++) {
      const spans: Array<[number, number]> = [];
      if (y >= f.arena.y0 && y <= f.arena.y1) spans.push([f.arena.x0, f.arena.x1]);
      for (const r of [f.damper, f.passage, f.shaft]) if (y >= r.y0 && y <= r.y1) spans.push([r.x0, r.x1]);
      for (const [x0, x1] of spans) {
        for (let x = x0; x <= x1; x++) {
          if (!w.inBounds(x, y)) continue;
          const i = w.idx(x, y);
          const t = w.types[i];
          if (t === Cell.Water || t === Cell.Ice || t === Cell.Snow) { w.replaceCellAt(i, Cell.Steam, steamColor()); w.life[i] = 160; continue; }
          if (t === Cell.Empty || t === Cell.Steam || t === Cell.Smoke || t === Cell.Fire || t === Cell.Ember || t === Cell.MarshGas || t === Cell.Oil || t === Cell.Blood) {
            w.replaceCellAt(i, Cell.Lava, lavaColor());
          }
        }
      }
    }
    this.filledTo = top;
  }

  private breathe(f: KilnFlueSite): void {
    const ctx = this.host.ctx;
    const w = ctx.world;
    const y = Math.floor(this.lavaRow) - 2;
    for (let k = 0; k < 2; k++) {
      const x = f.shaft.x0 + 2 + Math.floor(fxRandom() * (f.shaft.x1 - f.shaft.x0 - 4));
      if (!w.inBounds(x, y) || w.types[w.idx(x, y)] !== Cell.Empty) continue;
      const i = w.idx(x, y);
      w.replaceCellAt(i, Cell.Steam, steamColor());
      w.life[i] = 120;
    }
    const ex = f.shaft.x0 + fxRandom() * (f.shaft.x1 - f.shaft.x0);
    ctx.particles.spawn(ex, y, (fxRandom() - 0.5) * 0.3, -0.6 - fxRandom() * 0.8, null, packRGB(255, 120 + Math.floor(fxRandom() * 90), 30), 50, { glow: 2, grav: -0.01 });
  }

  /**
   * A STEAM GUST up the shaft's clear middle: told first (a hiss, the lava
   * boiling under the column), then a front of real steam rising fast. A body
   * caught mid-air in the column is knocked down and its jet snuffed; one
   * standing on a ledge is spared.
   */
  private gust(f: KilnFlueSite, now: number, dt: number): void {
    const ctx = this.host.ctx;
    const w = ctx.world;
    const p = ctx.player;
    const cx = Math.round((f.shaft.x0 + f.shaft.x1) / 2);
    if (this.gustRow === null) {
      if (!this.gustTold && now >= this.gustAt - GUST_TELL) {
        this.gustTold = true;
        const y = Math.floor(this.lavaRow) - 2;
        ctx.audio.steam(cx, y);
        ctx.particles.burst(cx, y, 16, null, () => packRGB(226, 230, 232), 1.6, { grav: -0.05 });
      }
      if (now >= this.gustAt) { this.gustRow = this.lavaRow - 2; this.gustHit = false; }
      return;
    }
    const prev = this.gustRow;
    this.gustRow -= GUST_SPEED * dt * 60;
    for (let y = Math.floor(this.gustRow); y <= Math.ceil(prev); y++) {
      if ((y & 1) !== 0) continue;
      for (let x = cx - GUST_HALF_W; x <= cx + GUST_HALF_W; x += 2) {
        if (!w.inBounds(x, y) || w.types[w.idx(x, y)] !== Cell.Empty || fxRandom() > 0.35) continue;
        const i = w.idx(x, y);
        w.replaceCellAt(i, Cell.Steam, steamColor());
        w.life[i] = 36;
      }
    }
    ctx.particles.burst(cx, this.gustRow, 3, null, () => packRGB(236, 238, 240), 1.1, { grav: -0.03 });
    // Caught in the column, off the ledges: knocked down, the jet snuffed.
    if (!this.gustHit && !p.dead && !p.grounded && Math.abs(p.x - cx) <= GUST_HALF_W + 1 && p.y >= this.gustRow && p.y - 17 <= prev + 2) {
      this.gustHit = true;
      p.vy = Math.max(p.vy, 2.4);
      p.levit = Math.min(p.levit, 15);
      ctx.fx.screenShake = Math.max(ctx.fx.screenShake, ctx.state.reduceCameraShake ? 0.006 : 0.02);
      ctx.audio.steam(p.x, p.y - 8);
    }
    if (this.gustRow < f.shaft.y0) {
      this.gustRow = null;
      this.gustTold = false;
      this.gustAt = now + GUST_EVERY;
    }
  }

  /** Cracked masonry comes away as the lava climbs past below it. */
  private crumble(f: KilnFlueSite): void {
    const ctx = this.host.ctx;
    const w = ctx.world;
    f.slabs.forEach((s, k) => {
      if (this.slabsDone.has(k) || this.lavaRow > s.at) return;
      this.slabsDone.add(k);
      for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) {
        if (!w.inBounds(x, y)) continue;
        const i = w.idx(x, y);
        if (w.types[i] === Cell.Stone) w.replaceCellAt(i, Cell.Sand, RUBBLE(x, y));
      }
      const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2;
      ctx.particles.burst(cx, cy, 14, null, () => packRGB(150, 132, 112), 1.8, { grav: 0.07 });
      ctx.audio.sfx('mat.hollow', cx, cy);
      ctx.fx.screenShake = Math.max(ctx.fx.screenShake, ctx.state.reduceCameraShake ? 0.008 : 0.03);
    });
  }

  /** Back to the foot of the flue: the shaft exactly as generated, the lava drained, a breath before it rises. */
  private restart(resumed: boolean): void {
    const ctx = this.host.ctx;
    const flue = this.flue;
    if (!flue) return;
    resetKilnFlue(ctx.world, flue);
    this.fuse(flue);
    this.lavaRow = flue.lavaFrom + 1;
    this.filledTo = flue.lavaFrom + 1;
    this.slabsDone.clear();
    this.deathAt = null;
    this.gustRow = null;
    this.gustTold = false;
    this.phase = 'heave';
    this.riseAt = this.host.now() + (resumed ? GRACE : RESTART_GRACE);
    if (this.fading) {
      this.fading = false;
      ctx.events.emit('storyFade', { on: false });
    }
    if (ctx.player.dead) ctx.playerCtl.respawn();
    else {
      ctx.player.x = flue.start.x; ctx.player.y = flue.start.y; ctx.player.vx = 0; ctx.player.vy = 0;
      ctx.camera.snapTo(ctx.player.x, ctx.player.y);
    }
    ctx.events.emit('objectiveChanged', { text: ESCAPE_OBJECTIVE });
    const rt = ctx.levels.current;
    if (rt) rt.mapWaypoint = { x: flue.exit.x, y: flue.exit.y, label: 'The Hatch' };
  }

  private complete(): void {
    this.phase = 'done';
    const run = this.host.run();
    this.host.setRun({ ...run, escape: 'done' });
    const done = this.onComplete;
    this.onComplete = null;
    done?.();
  }

  debug(): Record<string, unknown> {
    return {
      phase: this.phase, lavaRow: Math.round(this.lavaRow), riseIn: +(Math.max(0, this.riseAt - this.host.now())).toFixed(2), exit: this.flue?.exit ?? null, start: this.flue?.start ?? null,
      gustRow: this.gustRow === null ? null : Math.round(this.gustRow), gustIn: +(this.gustAt - this.host.now()).toFixed(2),
    };
  }
}
